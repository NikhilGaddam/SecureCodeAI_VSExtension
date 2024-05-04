import * as vscode from "vscode";
import axios, { CancelTokenSource } from "axios";
import { Configuration, OpenAIApi, CreateChatCompletionRequest } from "openai";
import createPrompt from "./prompt";
import {waitForAuthentication} from './authentication';


let secureLog = vscode.window.createOutputChannel("secureLog");
secureLog.show();

type AuthInfo = { apiKey?: string };
export type Settings = {
  selectedInsideCodeblock?: boolean;
  pasteOnClick?: boolean;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

export function activate(context: vscode.ExtensionContext) {
  waitForAuthentication();

  const provider = new AlvaViewProvider(context.extensionUri);

  const config = vscode.workspace.getConfiguration("alva");
  provider.setAuthenticationInfo({
    apiKey: config.get("apiKey"),
  });

  provider.setSettings({
    selectedInsideCodeblock: config.get("selectedInsideCodeblock") || false,
    pasteOnClick: config.get("pasteOnClick") || false,
    maxTokens: config.get("maxTokens") || 2048,
    temperature: config.get("temperature") || 0.4,
    model: config.get("model") || "gpt-4-turbo",
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      AlvaViewProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      }
    )
  );

  // 
  /**
   * 
   * @param command Type of action
   * @returns none
   * Handle actions using multiple types of interactions. ie, Selecting a snippet of code
   * A Middleware for all commands
   */
  const commandHandler = async (command: string) => {
    const temperature =
      command === "promptPrefix.complete"
        ? 0.4
        : command === "promptPrefix.unitTesting"
        ? 0.3
        : provider.getSettings().temperature;
    const config = vscode.workspace.getConfiguration("alva");
    const prompt = config.get(command) as string;

    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor) {
      const selection = activeTextEditor.selection;
      let selectedText = activeTextEditor.document.getText(selection);

      if (selection.isEmpty) {
        vscode.window.showInformationMessage("Please select a code snippet!");
        return;
      }
      if (selectedText.length > 2500) {
        vscode.window.showInformationMessage(
          "The selected code is too long. Please select less code."
        );
        return;
      }
    } else {
      vscode.window.showErrorMessage("No active editor found.");
      return;
    }
    if (
      command === "promptPrefix.documentation" ||
      command === "promptPrefix.complete" ||
      command === "promptPrefix.optimize"
    ) {
      const result = await provider.search(prompt);
      provider.clearInput();
      if (activeTextEditor && result) {
        const codeBlockRegex = /```.*\n[\s\S]*?```/g;
        const match = result.match(codeBlockRegex);
        let content = "";
        if (match) {
          content = match[0]
            .replace(/```.*\n/, "")
            .replace(/```/, "")
            .trim();
        }
        let selectionToReplace = activeTextEditor.selection;
        if (selectionToReplace.isEmpty) {
          vscode.window.showErrorMessage("No selection to replace.");
        }
        // Fix Indentation
        const line = activeTextEditor.document.lineAt(
          selectionToReplace.start.line
        );
        const initialIndentation = line.text.substring(
          0,
          line.firstNonWhitespaceCharacterIndex
        );
        const contentWithIndentation = content
          .split("\n")
          .map((line) => initialIndentation + line)
          .join("\n");
        const workspaceEdit = new vscode.WorkspaceEdit();
        // Remove old selection
        workspaceEdit.delete(activeTextEditor.document.uri, selectionToReplace);
        // Insert answer
        workspaceEdit.insert(
          activeTextEditor.document.uri,
          selectionToReplace.start,
          contentWithIndentation
        );
        // Save
        await vscode.workspace.applyEdit(workspaceEdit);
        provider.postMessageToWebview({
          type: "addResponse",
          value: "Done! Results pasted directly to editor.",
        });
      } else {
        provider.search(prompt);
        provider.clearInput();
      }
    } else {
      provider.search(prompt);
      provider.clearInput();
    }
  };

  // Inserting command "alva.ask"
  context.subscriptions.push(
    vscode.commands.registerCommand("alva.ask", () =>
      vscode.window
        .showInputBox({ prompt: "Ask anything code-related..." })
        .then((value) => {
          if (value && value.trim() !== "") {
            provider.search(value);
          } else {
            vscode.window.showErrorMessage("The input is empty.");
          }
        })
    ),
    vscode.commands.registerCommand("alva.optimize", () =>
      commandHandler("promptPrefix.optimize")
    ),
    vscode.commands.registerCommand("alva.explain", () =>
      commandHandler("promptPrefix.explain")
    ),
    vscode.commands.registerCommand("alva.complete", () =>
      commandHandler("promptPrefix.complete")
    ),
    vscode.commands.registerCommand("alva.unitTesting", () =>
      commandHandler("promptPrefix.unitTesting")
    ),
    vscode.commands.registerCommand("alva.documentation", () =>
      commandHandler("promptPrefix.documentation")
    )
  );
  vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      const config = vscode.workspace.getConfiguration("alva");
      if (event.affectsConfiguration("alva.apiKey")) {
        provider.setAuthenticationInfo({ apiKey: config.get("apiKey") });
        console.log("API Key changed");
      } else if (event.affectsConfiguration("alva.selectedInsideCodeblock")) {
        provider.setSettings({
          selectedInsideCodeblock:
            config.get("selectedInsideCodeblock") || false,
        });
      } else if (event.affectsConfiguration("alva.pasteOnClick")) {
        provider.setSettings({
          pasteOnClick: config.get("pasteOnClick") || false,
        });
      }
    }
  );
}

// * SecureCode main settings
let translatorLanguage = "javascript";
let functionLanguage = "javascript";
let functionOutputs = "";
let functionInputs = "";
let functionObjective = "";
let testsFramework = "preferable";
let testsInstructions = "";
let docsInstructions = "";

// View Provider
class AlvaViewProvider implements vscode.WebviewViewProvider {
  private lastCall = 99999;
  private cancelTokenSource?: CancelTokenSource;
  private cancelRequest() {
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel("Request canceled");
    }
  }
  public static readonly viewType = "alva.chatView";
  /**
   * Function to freely send any text to the webview
   * @param message String to send
   */
  public postMessageToWebview(message: any) {
    this._view?.webview.postMessage(message);
  }
  /**
   * Sends a message to webview to remove input text log
   */
  public clearInput() {
    this._view?.webview.postMessage({ type: "clearInput" });
  }
  // * Private Data
  private _view?: vscode.WebviewView;
  private _openai?: OpenAIApi;
  private _response?: string;
  private _prompt?: string;
  private _fullPrompt?: string;
  private _currentMessageNumber = 0;
  private _settings: Settings = {
    selectedInsideCodeblock: false,
    pasteOnClick: true,
    maxTokens: 2048,
    temperature: 0.6,
  };
  private startLoadingAnimation() {
    this._view?.webview.postMessage({ type: "startLoading" });
  }
  private stopLoadingAnimation() {
    this._view?.webview.postMessage({ type: "stopLoading" });
  }
  private _apiConfiguration?: Configuration;
  private _apiKey?: string;
  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Set up API Authentication info
   * @param authInfo Info object for Authentication
   */
  public setAuthenticationInfo(authInfo: AuthInfo) {
    this._apiKey = authInfo.apiKey;
    this._apiConfiguration = new Configuration({ apiKey: authInfo.apiKey });
    this._newAPI();
  }
  /**
   * Set up Settings for better control
   * @param settings Settings object for Extension
   */
  public setSettings(settings: Settings) {
    this._settings = { ...this._settings, ...settings };
  }
 
   /**
   * Get Settings
   * @returns Settings
   */
  public getSettings() {
    return this._settings;
  }
  private _newAPI() {
    if (!this._apiConfiguration || !this._apiKey) {
      console.warn(
        "OpenAI API key not set, please go to Preferences -> Settings -> SecureCode: API Key"
      );
    } else {
      this._openai = new OpenAIApi(this._apiConfiguration);
    }
  }
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    type AnalysisType =
      | "analyze-behavior"
      | "analyze-review"
      | "modify-debug"
      | "modify-complete"
      | "modify-document"
      | "modify-prettify"
      | "modify-coverage"
      | "modify-optimize"
      | "generate-convert-code"
      | "generate-generate-tests"
      | "generate-generate-code";
    type MessageData = { type: AnalysisType | string };
    webviewView.webview.onDidReceiveMessage((data: any) => {
      switch (data.type) {
        case "codeSelected": {
          if (!this._settings.pasteOnClick) {
            break;
          }
          let code = data.value;
          const snippet = new vscode.SnippetString();
          snippet.appendText(code);
          vscode.window.activeTextEditor?.insertSnippet(snippet);
          break;
        }
        case "prompt": {
          this.search(data.value);
          this.clearInput();
          break;
        }
        // case "terminal": {
        //   const workspaceFolders = vscode.workspace.workspaceFolders;
        //   const terminal = vscode.window.createTerminal(`SecureCode-Terminal`);
        //   terminal.show();
        //   const apiKey = this._apiKey;
        //   const cliPath = `${this._extensionUri}/resources/cli.py`;
        //   if (workspaceFolders && workspaceFolders.length > 0) {
        //     let currentDir = workspaceFolders[0].uri.fsPath;
        //     if (currentDir.startsWith("file://")) {
        //       currentDir = currentDir.substring(7);
        //     }
        //     let cliPathClean = cliPath;
        //     if (cliPath.startsWith("file://")) {
        //       cliPathClean = cliPath.substring(7);
        //     }
        //     const command = `python3 '${cliPathClean}' -c -k '${apiKey}' -d '${currentDir}'`;
        //     terminal.sendText("pip3 show openai || pip3 install openai");
        //     terminal.sendText(command);
        //     terminal.show();
        //   } else {
        //     vscode.window.showErrorMessage("Please open a workspace folder!");
        //   }
        // }
        case "clear": {
          this.clearInput();
          webviewView.webview.postMessage({
            type: "addResponse",
            value: "Your response will appear here...",
          });
          break;
        }
        case "regenerate": {
          if (this._prompt) this.search(this._prompt);
          this.clearInput();
          break;
        }
        case "languageSelected": {
          translatorLanguage = data.value;
          console.log("lang: " + translatorLanguage);
          break;
        }
        case "functionObjective": {
          functionObjective = data.value;
          console.log("lang: " + functionObjective);
          break;
        }
        case "functionInputs": {
          functionInputs = data.value;
          console.log("lang: " + functionInputs);
          break;
        }
        case "functionOutputs": {
          functionOutputs = data.value;
          console.log("lang: " + functionOutputs);
          break;
        }
        case "functionSelected": {
          functionLanguage = data.value;
          console.log("lang: " + functionLanguage);
          break;
        }
        case "frameworkSelected": {
          testsFramework = data.value;
          console.log("frame: " + testsFramework);
          break;
        }
        case "testsInstructions": {
          testsInstructions = data.value;
          console.log("instruct: " + testsInstructions);
          break;
        }
        case "docsInstructions": {
          docsInstructions = data.value;
          console.log("instruct: " + docsInstructions);
          break;
        }
        case "generate-convert-code":
        case "generate-generate-tests":
        case "generate-generate-code":
        case "analyze-behavior":
          this._settings.temperature = 0.2;
        case "analyze-review":
          this._settings.temperature = 0.2;
        case "modify-debug":
        case "modify-complete":
        case "modify-document":
        case "modify-prettify":
        case "modify-coverage":
        case "modify-optimize": {
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            vscode.window.showInformationMessage(
              "Please open a code file to modify."
            );
            return;
          }
          let text;
          let initialIndentation = "";
          if (editor.selection.isEmpty) {
            text = editor.document.getText();
          } else {
            text = editor.document.getText(editor.selection);
            const firstLine = editor.document.lineAt(editor.selection.start.line)?.text;
            initialIndentation = firstLine?.match(/^\s*/)?.[0] || '';
          }
          const prefixMap: { [K in AnalysisType]: string } = {
            "analyze-behavior":
              "Make simplified and short code behavior analysis showing inputs, outputs, and a very simplified concise and short flow in the following format: 'ᚦBEHAVIOR ANALYSIS\n\n▸Objective\n{summary}\n\n▸Inputs\n{list}\n\n▸Flow\n{list}\n\n▸Outputs\n{list}', do not return code or suggestions. The code: ",
            "analyze-review":
"SecureCode AI is tasked with enhancing software security by preemptively identifying and mitigating potential vulnerabilities and enforcing secure coding practices during the development phase, rather than post-deployment. In this context, your analysis is crucial for our AI-powered Visual Studio Code extension. Please examine the provided code snippet meticulously for any potential issues that could compromise its integrity, focusing on syntax, logic, performance, security vulnerabilities, and adherence to best practices. Our aim is to minimize the risk of common threats such as buffer overflows, SQL injections, and XSS vulnerabilities, which could be exploited by attackers to undermine software integrity and user data privacy. Your feedback should be structured as follows, offering up to Five - Eight specific recommendations for each category, without providing code snippets but rather descriptive guidance: Example response: '▸Syntax and logical errors (like:  Identify any syntax errors or logical flaws that could cause the code to behave unexpectedly or fail. ) (example):\n - Line 12: wrong indentation \n - Line 23: lacks closing parenthesis \n \n ▸Code refactoring and quality (Like: Suggest areas where the code could be made more readable or maintainable, such as using switch-case constructs over extensive if-else blocks, or modularizing repetitive code into functions.) (example):\n - Use switch case instead of many if-else for clarity \n - Separate repetitive code into functions \n \n ▸Performance optimization (Like: Recommend strategies to enhance the code's efficiency, like employing more effective sorting algorithms or caching results of resource-intensive operations for future use.)(example):\n - Use better sorting algorithm to save time \n - Store results of costly operations for reuse \n \n ▸Security vulnerabilities (Highlight specific security risks inherent in the code, such as the need for input sanitization to prevent SQL injection attacks, or the importance of using prepared statements in database interactions to safeguard against such vulnerabilities.) (example):\n - [SQL Injection (CWE-564)] Clean user input to avoid SQL attacks \n - [XSS injection (CWE-79)] Possibility of application that takes as input a username and a password (html). \n - [Use of Maloc (0) (CWE-687)] The code is allocating memory of size specified by the user (C) \n \n ▸Fix Security vulnerabilities (Advise on the above) (example):\n - [SQL Injection (CWE-564)] Explain How to fix the code to prevent SQL Injection \n - [XSS injection (CWE-79)] Explain How to fix the code to prevent XSS Injection \n - [Use of Maloc (0) (CWE-687)] Explain How to fix the code to prevent Use of Maloc (0) (CWE-687) \n \n Incorporate insights from recent research on the capabilities and limitations of AI in generating secure code, paying particular attention to areas where AI-generated code has been found lacking in security robustness. This analysis will not only help improve the immediate code at hand but also contribute to our ongoing efforts to refine SecureCode AI's functionality, ensuring it remains a valuable tool for developers aiming to fortify their code against emerging threats. Code: ",            "modify-debug": "Fix the given code completely by debugging and correcting all syntax errors. Your response should consist exclusively of the entire code fixed in a codeblock, without any additional explanations or commentary. Code: ",
         "modify-complete":
              "Provide a completion to the following code. It must be creative and smart, use whatever clues you find to generate it. Your response should consist exclusively of the entire new code in a codeblock, without any additional explanations or commentary. Make sure that the resulting code is clean, well-organized, and adheres to established coding standards. Code: ",
            "modify-document":
              "Generate concise documentation for the given code by adding comments, docstrings, and annotations based on language best practices. Your response should include the original code with added documentation, focusing on purpose, functionality, and important details for future developers. Keep it brief and avoid redundancy. Code: ",
            "modify-prettify":
              "Shorten the provided piece of code focusing on improving its readability and aesthetics. Remove unnecessary and unused code and apply the appropriate design patterns or principles. Your response should consist exclusively of the entire new code in a codeblock, without any additional explanations or commentary. Make sure that the resulting code looks good and production-suitable. Code: ",
            "modify-coverage":
              "Cover the given code by implementing proper handling of edge cases, errors and exceptions. Your response should consist exclusively of the entire new code in a codeblock, without any additional explanations or commentary. Code: ",
            "modify-optimize":
              "Refactor the provided piece of code into the best practices for the relevant programming language, focusing on improving its readability, maintainability, security, and performance while preserving its original functionality. Apply best practices for the relevant programming language, and utilize appropriate design patterns or principles. Your response should consist exclusively of the entire code refactored, without any additional explanations or commentary. Make sure that the resulting code is clean, well-organized, and adheres to established coding standards. Code: ",
            "generate-convert-code":
              "Convert the following code to " +
              translatorLanguage +
              ". Your response should consist exclusively of the entire new code in a codeblock, without any additional explanations or commentary. Code: ",
            "generate-generate-tests":
              "Generate unit tests for the following code snippet, using the " +
              testsFramework +
              " framework" +
              (testsInstructions
                ? ". important instructions for the tests: " + testsInstructions
                : "") +
              ". Any explanations or commentary must be in the form of a document inside the codeblock. Code: ",
            "generate-generate-code":
              "Generate a code function in " +
              functionLanguage +
              " using the following instructions, make it sophisticated and implement functionality. Objective: " +
              functionObjective +
              ", Inputs: " +
              functionInputs +
              ", Outputs: " +
              functionOutputs +
              ".\n\n",
          };

          const prefix = prefixMap[data.type as AnalysisType];
          let previousSelection: vscode.Selection | null = null;
          if (editor) {
            previousSelection = editor.selection;
          }
          if (data.type.startsWith("generate")) {
            this._response = "";
            console.log(prefix + text);
            this.search(prefix + text).then(async (result) => {
              if (result) {
                const codeBlockRegex = /```[\s\S]*?```/g;
                const match = result.match(codeBlockRegex);
                let content = "";
                if (match) {
                  const firstMatch = match[0];
                  content = firstMatch
                    .replace(/```[a-zA-Z]*\n/, "")
                    .replace(/```/, "")
                    .trim();
                }
                if (content) {
                  const newDoc = await vscode.workspace.openTextDocument({
                    content: "",
                    language: data.type.includes("tests") ? "plaintext" : data.type.includes("generate-code") ? functionLanguage : translatorLanguage
                  });
                  await vscode.window.showTextDocument(
                    newDoc,
                    vscode.ViewColumn.One
                  );
                  const editor = vscode.window.activeTextEditor;
                  if (editor) {
                    const insertionPosition = editor.selection.start;
                    const workspaceEdit = new vscode.WorkspaceEdit();
                    workspaceEdit.insert(
                      editor.document.uri,
                      insertionPosition,
                      content
                    );
                    await vscode.workspace.applyEdit(workspaceEdit);
                    this.postMessageToWebview({
                      type: "addResponse",
                      value: "Done! Results pasted in a new editor tab.",
                    });
                  } else {
                    vscode.window.showInformationMessage(
                      "No active editor found."
                    );
                  }
                } else {
                  vscode.window.showInformationMessage("No code to insert.");
                }
              }
            });
          }
          if (data.type.startsWith("modify")) {
            this._response = "";
            this.search(prefix + text).then(async (result) => {
              if (result && editor) {
                const codeBlockRegex = /```[\s\S]*?```/g;
                const match = result.match(codeBlockRegex);
                let content = "";
                if (match) {
                  const firstMatch = match[0];
                  content = firstMatch
                    .replace(/```[a-zA-Z]*\n/, "")
                    .replace(/```/, "")
                    .trim();
                }
                if (content) {
                  let selectionToReplace = editor.selection;
                  if (selectionToReplace.isEmpty) {
                    vscode.window.showErrorMessage("No selection to replace.");
                  }
                  const contentWithIndentation = content
                    .split("\n")
                    .map((line) => initialIndentation + line)
                    .join("\n");
                  const workspaceEdit = new vscode.WorkspaceEdit();
                  workspaceEdit.delete(editor.document.uri, selectionToReplace);
                  workspaceEdit.insert(
                    editor.document.uri,
                    selectionToReplace.start,
                    contentWithIndentation
                  );
                  await vscode.workspace.applyEdit(workspaceEdit);
                  this.postMessageToWebview({
                    type: "addResponse",
                    value: "Done! Results pasted directly to editor.",
                  });
                } else {
                  vscode.window.showInformationMessage("No code to insert.");
                }
              }
            });
          } else {
            this.search(prefix + text);
          }
          this.clearInput();
          break;
        }
      }
    });
  }
  public async resetSession() {
    this._prompt = "";
    this._response = "";
    this._fullPrompt = "";
    this._view?.webview.postMessage({ type: "setPrompt", value: "" });
    this._view?.webview.postMessage({ type: "addResponse", value: "" });
    this._newAPI();
  }
  public async search(prompt?: string, command?: string, temperature?: number) {
    const currentTime = Date.now();
    const timeDifference = currentTime - this.lastCall;
    const waitTime = 6500;
    this._view?.webview.postMessage({ type: "clearInput" });
    if (timeDifference < waitTime) {
      vscode.window.showInformationMessage(
        "Make sure to wait between queries."
      );
      return;
    }
    this.lastCall = currentTime;
    try {
    } catch (error) {
      vscode.window.showErrorMessage(
        "An error occurred while making the API call."
      );
    }
    console.log("After check: this.lastCall Check = ", this.lastCall);
    this.startLoadingAnimation();
    this._prompt = prompt;
    if (!prompt) {
      return;
    }
    if (!this._openai) {
      this._newAPI();
    }
    if (!this._view) {
      await vscode.commands.executeCommand("alva.chatView.focus");
    } else {
      this._view?.show?.(true);
    }
    let response = "";
    this._response = "";
    const selection = vscode.window.activeTextEditor?.selection;
    const selectedText =
      vscode.window.activeTextEditor?.document.getText(selection);

    // ? Why not just putting to this._fullPrompt first?
    let searchPrompt = createPrompt(prompt, this._settings, selectedText);
    this._fullPrompt = searchPrompt;
    console.log(`Sending request to OpenAI: Prompt: ${searchPrompt}`);
    // secureLog.appendLine(`Sending request to OpenAI: Prompt: ${searchPrompt}`);
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ type: "addResponse", value: response });
    }
    if (!this._openai) {
      response =
        "[ERROR] OpenAI API key not set, please go to Preferences -> Settings -> SecureCode: API Key";
    } else {
      this._view?.webview.postMessage({
        type: "setPrompt",
        value: this._prompt,
      });
      this._view?.webview.postMessage({
        type: "addResponse",
        value: "Working on it...",
      });
      this._currentMessageNumber++;
      try {
        let currentMessageNumber = this._currentMessageNumber;
        

        let completion;
        if (this._settings.model !== "ChatGPT") {
          completion = await this._openai.createChatCompletion({
            model: this._settings.model || "gpt-4-turbo",
            messages: [{ role: "user", content: this._fullPrompt }],
            temperature: temperature || this._settings.temperature,
            max_tokens: this._settings.maxTokens,
            stop: ["\nUSER: ", "\nUSER", "\nASSISTANT"],
          });
        } else {
          completion = await this._openai.createChatCompletion({
            model: "gpt-4-turbo",
            messages: [{ role: "user", content: this._fullPrompt }],
            temperature: temperature || this._settings.temperature,
            max_tokens: this._settings.maxTokens,
            stop: ["\n\n\n", ""],
          });
        }
        if (this._currentMessageNumber !== currentMessageNumber) {
          return;
        }
        response = completion.data.choices[0].message?.content || "";
        const REGEX_CODEBLOCK = new RegExp("```", "g");
        const matches = response.match(REGEX_CODEBLOCK);
        const count = matches ? matches.length : 0;
        if (count % 2 !== 0) {
          response += "\n```";
        }
        response += `\n\n`;
        if (completion.data.choices[0].finish_reason === "length") {
          response += `\n[WARNING] The response was trimmed due to length.\n\n`;
        }
        response += ``;
      } catch (error: any) {
        let e = "";
        if (error.response) {
          console.log(error.response.status);
          console.log(error.response.data);
          e = `${error.response.status} ${error.response.data.message}`;
        } else {
          console.log(error.message);
          e = error.message;
        }
        response += `\n\n---\n[ERROR] ${e}`;
      }
    }
    this._response = response;
    console.log("Response: ", response);
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ type: "addResponse", value: response });
      this.stopLoadingAnimation();
    }
    return this._response;
  }
  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const microlightUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "microlight.min.js"
      )
    );
    const tailwindUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "showdown.min.js"
      )
    );
    const showdownUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "tailwind.min.js"
      )
    );
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="${tailwindUri}"></script>
      <script src="${showdownUri}"></script>
      <script src="${microlightUri}"></script>

      

      <script src="https://accounts.google.com/gsi/client" async></script>
      <link href='https://fonts.googleapis.com/css?family=Lato' rel='stylesheet'>

      <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500&display=swap');
        * {}
        .code {
          white-space: pre;
        }
        @keyframes shimmer {
          0% {
            background-position: -50px 0;
          }
          100% {
            background-position: 150px 0;
          }
        }
        @keyframes increaseWidth {
          0% {
            width: 0;
          }
          65% {
            width: 65%;
          }
          100% {
            width: 100%;
          }
        }
        p {
          background-color: rgba(0, 0, 0, 0.05),
            border-radius: 10px;
          padding-left: 0.5rem;
          padding-right: 0.5rem;
          padding-top: 0.65rem;
          padding-bottom: 0.65rem;
        }
        ul,
        ol {
          margin: 3px !important;
          padding-top: 8px !important;
          padding-bottom: 8px !important;
          padding-right: 8px !important;
          border-radius: 8px !important;
          background-color: rgba(0, 0, 0, 0.1) !important;
          list-style-type: none !important;
          padding-left: 1.5em !important;
        }
        ul li::before,
        ol li::before {
          content: "-" !important;
          margin-right: 0.35em !important;
        }
        .btn-group {
          width: 200px;
          display: flex;
        }
        #loadingBar {
          width: 0;
          width: 96%;
          height: 1.5px;
          transition: width 0.3s ease-out;
          position: -webkit-sticky;
          background-size: 10px 100%;
          animation: shimmer 2s infinite linear;
          position: sticky;
          width: 0;
          background-color: #e45015;
          background: linear-gradient(to right, rgba(87, 71, 255, 0.45) 45%, rgba(87, 71, 255, 0.65) 60%, rgba(87, 71, 255, 0.45) 75%);
          animation: shimmer 2s infinite linear, increaseWidth 5s;
          border-radius: 10px;
        }
        }
        hr {
          border: 0;
          height: 1px;
          background: #000;
          opacity: 0.2;
        }
        .btn-group .btn {
          flex: 1;
          padding: 2px;
          margin-bottom: 3px;
          border-width: 1.5px;
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
          border-color: rgba(255, 255, 255, 0.05);
          cursor: pointer;
        }
        .btn-group .btn.selected {
          color: #aca6e8;
          border-color: #aca6e8;
        }
        .button-with-icon {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        summary::-webkit-details-marker {
          display: none;
      }
      summary::marker {
          display: none;
      }
      summary::before {
          content: "";
          display: inline-block;
          width: 16px;
          height: 16px;
          background-size: contain;
      }
        .button-with-icon svg {
          width: 12px;
          height: 12px;
          fill: #C0B9FF;
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-weight: bold !important;
        }
        body {
          transition: all 0.3s ease;
          padding-top: 10px;
        }
        textarea {
          overflow-y: hidden;
          border-width: 1.5px;
          font-size: 12.5px !important;
          border-color: rgba(255, 255, 255, 0.1);
          top: 10rem;
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
        }
        textarea:focus {
          padding-bottom: 10px;
          text-color: white;
          border-width: 1.5px;
          border-color: #ef533f;
          background-color: rgba(154, 145, 255, 0.15);
          box-shadow: 0 0.045rem 4px rgba(188, 181, 255, 0.095);
          outline: none;
        }
        .div-style-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .documentation-style-dropdown,
        .testing-framework-dropdown {
          flex: 1;
          padding: 2px;
          font-size: 12px;
          border-radius: 4px;
          border: 1.5px solid rgba(255, 255, 255, 0.035);
          background-color: rgba(255, 255, 255, 0.035);
          transition: all 0.3s ease;
          cursor: pointer;
          max-width: 200px;
        }
        .documentation-style-dropdown:focus,
        .testing-framework-dropdown:focus {
          border-color: #e45015;
          background-color: rgba(255, 255, 255, 0.065);
          outline: none;
        }
        .input-small-target {
          padding: 2px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16ZM12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18ZM12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14Z" fill="rgba(255,255,255,0.25)"></path></svg>');
          background-repeat: no-repeat;
          background-position: 4px center;
          background-size: 16px 16px;
          color: #ffffff;
          border-width: 1.5px;
          font-size: 12px;
          width: 200px;
          padding-left: 24px;
          border-color: rgba(255, 255, 255, 0.035);
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.035);
          transition: all 0.3s ease;
        }
        .input-small-target:focus {
          border-color: #e45015;
          border-width: 1.5px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16ZM12 18C8.68629 18 6 15.3137 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18ZM12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14Z" fill="rgba(255,255,255,0.85)"></path></svg>');
          background-color: rgba(255, 255, 255, 0.065);
          transition: all 0.3s ease;
          outline: none;
        }
        .input-small-in {
          padding: 2px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M10 11V8L15 12L10 16V13H1V11H10ZM2.4578 15H4.58152C5.76829 17.9318 8.64262 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C8.64262 4 5.76829 6.06817 4.58152 9H2.4578C3.73207 4.94289 7.52236 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C7.52236 22 3.73207 19.0571 2.4578 15Z" fill="rgba(255,255,255,0.25)"></path></svg>');
          background-repeat: no-repeat;
          background-position: 4px center;
          background-size: 16px 16px;
          color: #ffffff;
          border-width: 1.5px;
          font-size: 12px;
          width: 200px;
          padding-left: 24px;
          border-color: rgba(255, 255, 255, 0.035);
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.035);
          transition: all 0.3s ease;
        }
        .input-small-in:focus {
          border-color: #e45015;
          border-width: 1.5px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M10 11V8L15 12L10 16V13H1V11H10ZM2.4578 15H4.58152C5.76829 17.9318 8.64262 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C8.64262 4 5.76829 6.06817 4.58152 9H2.4578C3.73207 4.94289 7.52236 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C7.52236 22 3.73207 19.0571 2.4578 15Z" fill="rgba(255,255,255,0.85)"></path></svg>');
          background-color: rgba(255, 255, 255, 0.065);
          transition: all 0.3s ease;
          outline: none;
        }
        .input-small-out {
          padding: 2px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M5 11H13V13H5V16L0 12L5 8V11ZM3.99927 18H6.70835C8.11862 19.2447 9.97111 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C9.97111 4 8.11862 4.75527 6.70835 6H3.99927C5.82368 3.57111 8.72836 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C8.72836 22 5.82368 20.4289 3.99927 18Z" fill="rgba(255,255,255,0.25)"></path></svg>');
          background-repeat: no-repeat;
          background-position: 4px center;
          background-size: 16px 16px;
          color: #ffffff;
          border-width: 1.5px;
          font-size: 12px;
          width: 200px;
          padding-left: 24px;
          border-color: rgba(255, 255, 255, 0.035);
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.035);
          transition: all 0.3s ease;
        }
        .input-small-out:focus {
          border-color: #e45015;
          border-width: 1.5px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M5 11H13V13H5V16L0 12L5 8V11ZM3.99927 18H6.70835C8.11862 19.2447 9.97111 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C9.97111 4 8.11862 4.75527 6.70835 6H3.99927C5.82368 3.57111 8.72836 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C8.72836 22 5.82368 20.4289 3.99927 18Z" fill="rgba(255,255,255,0.85)"></path></svg>');
          background-color: rgba(255, 255, 255, 0.065);
          transition: all 0.3s ease;
          outline: none;
        }
        .input-small-spark {
          padding: 2px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M15 5.25C16.7949 5.25 18.25 3.79493 18.25 2H19.75C19.75 3.79493 21.2051 5.25 23 5.25V6.75C21.2051 6.75 19.75 8.20507 19.75 10H18.25C18.25 8.20507 16.7949 6.75 15 6.75V5.25ZM4 7C4 5.89543 4.89543 5 6 5H13V3H6C3.79086 3 2 4.79086 2 7V17C2 19.2091 3.79086 21 6 21H18C20.2091 21 22 19.2091 22 17V12H20V17C20 18.1046 19.1046 19 18 19H6C4.89543 19 4 18.1046 4 17V7Z" fill="rgba(255,255,255,0.25)"></path></svg>');
          background-repeat: no-repeat;
          background-position: 4px center;
          background-size: 16px 16px;
          color: #ffffff;
          border-width: 1.5px;
          font-size: 12px;
          width: 200px;
          padding-left: 24px;
          border-color: rgba(255, 255, 255, 0.035);
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.035);
          transition: all 0.3s ease;
        }
        .input-small-spark:focus {
          border-color: #e45015;
          border-width: 1.5px;
          background-image: url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M15 5.25C16.7949 5.25 18.25 3.79493 18.25 2H19.75C19.75 3.79493 21.2051 5.25 23 5.25V6.75C21.2051 6.75 19.75 8.20507 19.75 10H18.25C18.25 8.20507 16.7949 6.75 15 6.75V5.25ZM4 7C4 5.89543 4.89543 5 6 5H13V3H6C3.79086 3 2 4.79086 2 7V17C2 19.2091 3.79086 21 6 21H18C20.2091 21 22 19.2091 22 17V12H20V17C20 18.1046 19.1046 19 18 19H6C4.89543 19 4 18.1046 4 17V7Z" fill="rgba(255,255,255,0.85)"></path></svg>');
          background-color: rgba(255, 255, 255, 0.065);
          transition: all 0.3s ease;
          outline: none;
        }
        .alva-icon {
          transition: box-shadow 0.3s ease;
        }
        .input-icon {
          transition: box-shadow 0.3s ease;
        }
        .send-button {
          position: absolute;
          margin-top: 12px;
          right: 30px;
          text-align: center;
          text-decoration: none;
          display: inline-block;
          cursor: pointer;
        }
        .button-clear-input {
          position: absolute;
          margin-top: 12px;
          left: 31px;
          text-align: center;
          font-size: 11.5px;
          letter-spacing: 0.15px;
          text-decoration: none;
          display: inline-block;
          cursor: pointer;
        }
        .tab-container {
          padding-bottom: 10px;
          display: flex;
          justify-content: center;
          font-weight: '500';
          font-family: 'Lato';
        }
        .tab {
          transition: 0.2s ease;
          transition: 0.3s width;
          border-bottom: 1.5px solid;
          border-bottom-color: rgba(255, 255, 255, 0.085);
          cursor: pointer;
        }
        .tab.active {
          color: #FFFF;
          border-bottom: 1.5px solid;
          border-bottom-color: #e45015;
        }
        @keyframes shimmer {
          0% {
            background-position: -468px 0;
          }
          100% {
            background-position: 468px 0;
          }
        }
        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(0.95);
          }
          100% {
            transform: scale(1);
          }
        }
        .big-button {
          padding: 12px 5px 12px 5px;
          font-family: 'Lato';
          background-color: #ef533f;
          color: #FFF;
          width: 100%;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        .big-button:before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-image: linear-gradient(to right,
              rgba(255, 255, 255, 0) 0%,
              rgba(255, 255, 255, 0.05) 20%,
              rgba(255, 255, 255, 0.1) 50%,
              rgba(255, 255, 255, 0.05) 80%,
              rgba(255, 255, 255, 0) 100%);
          background-repeat: no-repeat;
          background-size: 200% 100%;
          animation: shimmer 2s linear infinite;
          z-index: 1;
        }
        .big-button:active {
          animation: pulse 0.2s;
          transform: scale(0.97);
          transition: transform 0.15s ease-in-out;
        }
        .medium-button {
          padding: 6px 0px 8px 0px;
          font-family: 'Lato';
          background-color: rgba(205, 200, 255, 0.04);
          width: 100%;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        .medium-button:before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-image: linear-gradient(to right,
              rgba(255, 255, 255, 0) 0%,
              rgba(255, 255, 255, 0.0085) 20%,
              rgba(255, 255, 255, 0.025) 50%,
              rgba(255, 255, 255, 0.0085) 80%,
              rgba(255, 255, 255, 0) 100%);
          background-repeat: no-repeat;
          background-size: 200% 100%;
          animation: shimmer 2s linear infinite;
          z-index: 1;
        }
        .medium-button:active {
          animation: pulse 0.2s;
          transform: scale(0.97);
          transition: transform 0.15s ease-in-out;
        }
        .generate-button {
          width: 44%;
          background-color: #e45015;
          color: #FFF;
          margin: 8px 0 0 0;
          padding: 6px 12px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
        }
        .review-flex-container {
          display: flex;
          align-self: center;
          justify-content: center;
          padding-bottom: 10px;
          border-bottom: 1.5px solid;
          border-bottom-color: rgba(255, 255, 255, 0.04);
          flex-direction: row;
        }
        .flex-container {
          display: flex;
          padding-bottom: 12px;
          margin-bottom: 8px;
          border-bottom: 1.5px solid;
          border-bottom-color: rgba(255, 255, 255, 0.04);
          justify-content: space-between;
          flex-direction: column;
        }
        .big-text {
          top: 1.5px;
          font-size: 12.5px;
          font-weight: '600';
        }
        summary.big-text::-webkit-details-marker {  
          display: none;
      }
      .big-text::before {  
          padding-right: 2.5px;
      }
      details[open] .big-text::before {
          padding-right: 2.5px;
        }
        .small-text {
          font-size: 12px;
          font-weight: '300';
        }
      </style>
    </head>
    <body style="font-family: 'Lato'; font-weight: '400'; font-size: 12px; line-height: 2 !important;">
      <div>
        <div id="analyze-content">
        <div>
          <div class="review-flex-container mb-3">
            <script>
              function submitPrompt(prompt) {
                vscode.postMessage({
                  type: 'submitPrompt',
                  value: prompt
                });
              }
            </script>
            <div class="m-1 w-full">
              <button class="big-button subpixel-antialiased text-[12px] tracking-wider flex items-center" id="btn-review">
              <svg xmlns="http://www.w3.org/2000/svg" class="ml-2" viewBox="0 0 24 24" width="16" height="16"><path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748ZM12.1779 7.17624C11.4834 7.48982 11 8.18846 11 9C11 10.1046 11.8954 11 13 11C13.8115 11 14.5102 10.5166 14.8238 9.82212C14.9383 10.1945 15 10.59 15 11C15 13.2091 13.2091 15 11 15C8.79086 15 7 13.2091 7 11C7 8.79086 8.79086 7 11 7C11.41 7 11.8055 7.06167 12.1779 7.17624Z" fill="rgba(255,255,255,1)"></path></svg>
                <div class="mx-auto pr-6">Analyze Code</div>
              </button>
            </div>
          </div>
          <div>
            <textarea class="w-full subpixel-antialiased p-2 pl-8 pr-8 mb-1" style="resize: none;" rows="1"
              placeholder="Ask anything about code..." id="prompt-input" oninput="autoExpand(this)"
              onkeydown="preventNewLine(event)"></textarea>
            <button id="submit-button" class="send-button">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M3.5 1.3457C3.58425 1.3457 3.66714 1.36699 3.74096 1.4076L22.2034 11.562C22.4454 11.695 22.5337 11.9991 22.4006 12.241C22.3549 12.3241 22.2865 12.3925 22.2034 12.4382L3.74096 22.5925C3.499 22.7256 3.19497 22.6374 3.06189 22.3954C3.02129 22.3216 3 22.2387 3 22.1544V1.8457C3 1.56956 3.22386 1.3457 3.5 1.3457ZM5 4.38261V11.0001H10V13.0001H5V19.6175L18.8499 12.0001L5 4.38261Z" fill="rgba(255,255,255,1)"></path></svg>
            </button>
            <script>
              // Handle clear input event
              window.addEventListener("message", (event) => {
                const message = event.data;
                if (message.type === "clearInput") {
                  clearAndShrink();
                }
              });
              window.addEventListener("setPrompt", (event) => {
                clearAndShrink();
              });
              function clearAndShrink() {
                var textarea = document.getElementById('prompt-input');
                textarea.value = '';
                textarea.style.height = 'auto';
              }
              function autoExpand(element) {
                element.style.height = "auto";
                element.style.height = element.scrollHeight + "px";
              }
              function preventNewLine(event) {
                if (event.keyCode === 13) {
                  event.preventDefault();
                }
              }
            </script>
            </div>

        </div>
        </div>
        </div>
        </div>
        </div>
        <script src="${scriptUri}"></script>
        <script>
          // Tab functionality
          const analyzeTab = document.getElementById('analyze-tab');
          const analyzeContent = document.getElementById('analyze-content');

          analyzeTab.addEventListener('click', () => {
            analyzeTab.classList.add('active');
            analyzeContent.style.display = 'block';
          });
        </script>
      </div>
      <div id="loader" class="hidden w-full bg-[rgba(70,57,204,0.15)]">
        <div id="loadingBar" class="h-full bg-[rgba(70,57,204,0.85)]" style="loading-bar"></div>
      </div>
      <div class="flex items-center space-x-2 py-3">
        <button class="flex items-center text-[10px] pl-3 text-[#ff5757] button-with-icon" id="clear">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z" fill="rgba(211,206,255,1)"></path></svg>
          <span style="letter-spacing:0.5px;">Clear</span>
        </button>
        <button class="flex items-center text-[10px] pl-3 text-[#ff5757] button-with-icon" id="regenerate">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M5.46257 4.43262C7.21556 2.91688 9.5007 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C9.84982 4 7.89777 4.84827 6.46023 6.22842L5.46257 4.43262ZM18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 9.86386 2.66979 7.88416 3.8108 6.25944L7 12H4C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z" fill="rgba(211,206,255,1)"></path></svg>
        <span style="letter-spacing:0.5px;">Regenerate</span>
        </button>
      </div>
      <div id="response" class="py-2 px-3 mb-3 subpixel-antialiased rounded bg-[rgba(0,0,0,0.1)] text-[12]">
        <p class="has-line-data" data-line-start="0" data-line-end="3">Hey! I’m SecureCode 🤖<br>
          An assistant designed to help you with queries for an overall better, much smarter workflow 🧠<br></p>
      </div>
      <script>
        var responseDiv = document.getElementById('response');
        if (responseDiv.textContent.trim().length > 0) {
          responseDiv.style.display = 'block';
        }
      </script>
    </body>
    </html>`;
  }
}
