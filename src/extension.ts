// * Incase you want to understand it more, install "Better Comments"
import * as vscode from "vscode";
import axios, { CancelTokenSource } from "axios";
import { Configuration, OpenAIApi, CreateChatCompletionRequest } from "openai";
import createPrompt from "./prompt";
import {waitForAuthentication} from './authentication';

type AuthInfo = { apiKey?: string };
export type Settings = {
  selectedInsideCodeblock?: boolean;
  pasteOnClick?: boolean;
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

// * Start of life
export function activate(context: vscode.ExtensionContext) {
  waitForAuthentication();
  //startAuthentication()
  // Setup the Bar view
  const provider = new AlvaViewProvider(context.extensionUri);

  // Get settings
  const config = vscode.workspace.getConfiguration("alva");
  provider.setAuthenticationInfo({
    apiKey: config.get("apiKey"),
  });

  // View Settings
  provider.setSettings({
    selectedInsideCodeblock: config.get("selectedInsideCodeblock") || false,
    pasteOnClick: config.get("pasteOnClick") || false,
    maxTokens: config.get("maxTokens") || 2048,
    temperature: config.get("temperature") || 0.4,
    model: config.get("model") || "gpt-4-turbo",
  });

  // Insert view 
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
        case "terminal": {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const terminal = vscode.window.createTerminal(`SecureCode-Terminal`);
          terminal.show();
          const apiKey = this._apiKey;
          const cliPath = `${this._extensionUri}/resources/cli.py`;
          if (workspaceFolders && workspaceFolders.length > 0) {
            let currentDir = workspaceFolders[0].uri.fsPath;
            if (currentDir.startsWith("file://")) {
              currentDir = currentDir.substring(7);
            }
            let cliPathClean = cliPath;
            if (cliPath.startsWith("file://")) {
              cliPathClean = cliPath.substring(7);
            }
            const command = `python3 '${cliPathClean}' -c -k '${apiKey}' -d '${currentDir}'`;
            terminal.sendText("pip3 show openai || pip3 install openai");
            terminal.sendText(command);
            terminal.show();
          } else {
            vscode.window.showErrorMessage("Please open a workspace folder!");
          }
        }
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
              "Please analyze the code below for any syntax or logical inconsistencies, and provide suggestions for code optimization, security enhancement, and best practices alignment. Ensure your feedback is specific and focused, giving a maximum of three recommendations for each area and only contains verbal examples, no code. Example response: 'ᚦCODE REVIEW\n\n▸Syntax and logical errors (example):\n- Line 12: wrong indentation \n- Line 23: lacks closing parenthesis \n\n▸Code refactoring and quality (example):\n- Use switch case instead of many if-else for clarity \n- Separate repetitive code into functions \n\n▸Performance optimization (example):\n- Use better sorting algorithm to save time \n- Store results of costly operations for reuse \n\n▸Security vulnerabilities (example):\n- Clean user input to avoid SQL attacks \n- Use prepared statements for database queries \n\n▸Best practices (example):\n- Add comments and documentation to clarify code \n- Use consistent naming for variables and functions' \n\nCode: ",
            "modify-debug":
              "Fix the given code completely by debugging and correcting all syntax errors. Your response should consist exclusively of the entire code fixed in a codeblock, without any additional explanations or commentary. Code: ",
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
    console.log("After check: this.lastCall = ", this.lastCall);
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
          background-color: #5747FF;
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
          border-color: #6859FF;
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
          border-color: #5747FF;
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
          border-color: #5747FF;
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
          border-color: #5747FF;
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
          border-color: #5747FF;
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
          border-color: #5747FF;
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
          font-family: 'Poppins', sans-serif;
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
          border-bottom-color: #5747FF;
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
          font-family: 'Poppins', sans-serif;
          background-color: #4e40e6;
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
          font-family: 'Poppins', sans-serif;
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
          background-color: #5747FF;
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
    <body style="font-family: 'Poppins', sans-serif; font-weight: '400'; font-size: 12px; line-height: 2 !important;">
      <div>
        <div>
          <div class="tab-container w-full">
            <div class="tab active text-[12.5px] text-[rgba(221,218,255,0.5)] tracking-wide pb-2 text-center w-[32%]" id="chat-tab">Chat
            </div>
            <div class="tab text-[12.5px] text-[rgba(221,218,255,0.5)] tracking-wide pb-2 text-center w-[32%]" id="modify-tab">Modify
            </div>
            <div class="tab text-[12.5px] text-[rgba(221,218,255,0.5)] tracking-wide pb-2 text-center w-[32%]" id="analyze-tab">Analyze
            </div>
            <div class="tab text-[12.5px] text-[rgba(221,218,255,0.5)] tracking-wide pb-2 text-center w-[32%]" id="generate-tab">Generate
            </div>
          </div>
        </div>
        <div id="chat-content">
        <a href="https://accounts.google.com/o/oauth2/v2/auth/oauthchooseaccount?access_type=offline&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.profile&response_type=code&client_id=126672882416-dq83ed730p5s3kk4eteiqv4ifc00ppf4.apps.googleusercontent.com&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fgoogle&service=lso&o2v=2&flowName=GeneralOAuthFlow">LOGIN</a>
          <div>
            <button class="button-clear-input" onclick="clearAndShrink()">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z" fill="rgba(255,255,255,1)"></path></svg>
            </button>
            <textarea class="w-full subpixel-antialiased p-2 pl-8 pr-8 mb-1" style="resize: none;" rows="1"
              placeholder="Ask anything code-related..." id="prompt-input" oninput="autoExpand(this)"
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
        <div id="modify-content" style="display: none;">
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
              <div class="w-full flex flex-wrap">
                <div class="w-1/2">
                  <div class="m-1 pb-[3px]">
                    <button
                      class="medium-button subpixel-antialiased text-[11.5px] tracking-wider flex justify-between items-center"
                      id="btn-debug">
                      <svg class="ml-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M10.5621 4.14773C11.0262 4.05083 11.5071 3.99989 12 3.99989C12.4929 3.99989 12.9738 4.05083 13.4379 4.14773L15.1213 2.46436L16.5355 3.87857L15.4859 4.92822C16.7177 5.63698 17.7135 6.70984 18.3264 7.99989H21V9.99989H18.9291C18.9758 10.3265 19 10.6604 19 10.9999V11.9999H21V13.9999H19V14.9999C19 15.3394 18.9758 15.6733 18.9291 15.9999H21V17.9999H18.3264C17.2029 20.3648 14.7924 21.9999 12 21.9999C9.2076 21.9999 6.7971 20.3648 5.67363 17.9999H3V15.9999H5.07089C5.02417 15.6733 5 15.3394 5 14.9999V13.9999H3V11.9999H5V10.9999C5 10.6604 5.02417 10.3265 5.07089 9.99989H3V7.99989H5.67363C6.28647 6.70984 7.28227 5.63698 8.51412 4.92822L7.46447 3.87857L8.87868 2.46436L10.5621 4.14773ZM12 5.99989C9.23858 5.99989 7 8.23847 7 10.9999V14.9999C7 17.7613 9.23858 19.9999 12 19.9999C14.7614 19.9999 17 17.7613 17 14.9999V10.9999C17 8.23847 14.7614 5.99989 12 5.99989ZM9 13.9999H15V15.9999H9V13.9999ZM9 9.99989H15V11.9999H9V9.99989Z" fill="rgba(255,255,255,1)"></path></svg>                      <div class="mx-auto pr-6 pl-1">DEBUG</div>
                    </button>
                  </div>
                  <div class="m-1 pb-[3px]">
                    <button
                      class="medium-button subpixel-antialiased text-[11.5px] tracking-wider flex justify-between items-center"
                      id="btn-document">
                      <svg class="ml-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M13 21V23H11V21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3H9C10.1947 3 11.2671 3.52375 12 4.35418C12.7329 3.52375 13.8053 3 15 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H13ZM20 19V5H15C13.8954 5 13 5.89543 13 7V19H20ZM11 19V7C11 5.89543 10.1046 5 9 5H4V19H11Z" fill="rgba(255,255,255,1)"></path></svg>                      <div class="mx-auto pr-6 pl-1">DOCUMENT</div>
                    </button>
                  </div>
                  <div class="m-1 pb-[3px]">
                    <button
                      class="medium-button subpixel-antialiased text-[11.5px] tracking-wider flex justify-between items-center"
                      id="btn-coverage">
                      <svg class="ml-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M12 1L20.2169 2.82598C20.6745 2.92766 21 3.33347 21 3.80217V13.7889C21 15.795 19.9974 17.6684 18.3282 18.7812L12 23L5.6718 18.7812C4.00261 17.6684 3 15.795 3 13.7889V3.80217C3 3.33347 3.32553 2.92766 3.78307 2.82598L12 1ZM12 3.04879L5 4.60434V13.7889C5 15.1263 5.6684 16.3752 6.7812 17.1171L12 20.5963L17.2188 17.1171C18.3316 16.3752 19 15.1263 19 13.7889V4.60434L12 3.04879ZM16.4524 8.22183L17.8666 9.63604L11.5026 16L7.25999 11.7574L8.67421 10.3431L11.5019 13.1709L16.4524 8.22183Z" fill="rgba(255,255,255,1)"></path></svg>
                      <div class="mx-auto pr-6 pl-1">COVERAGE</div>
                    </button>
                  </div>
                </div>
                <div class="w-1/2">
                  <div class="m-1 pb-[3px]">
                    <button
                      class="medium-button subpixel-antialiased text-[11.5px] tracking-wider flex justify-between items-center"
                      id="btn-complete">
                      <svg class="ml-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M15.1986 9.94435C14.7649 9.53358 14.4859 8.98601 14.4085 8.39371L14.0056 5.31126L11.275 6.79711C10.7503 7.08262 10.1433 7.17876 9.55608 7.06936L6.49998 6.50003L7.06931 9.55612C7.17871 10.1434 7.08257 10.7503 6.79707 11.275L5.31121 14.0056L8.39367 14.4085C8.98596 14.4859 9.53353 14.7649 9.94431 15.1986L12.0821 17.4555L13.4178 14.6485C13.6745 14.1091 14.109 13.6745 14.6484 13.4179L17.4555 12.0821L15.1986 9.94435ZM15.2238 15.5078L13.0111 20.1579C12.8687 20.4572 12.5107 20.5843 12.2115 20.4419C12.1448 20.4102 12.0845 20.3664 12.0337 20.3127L8.49229 16.574C8.39749 16.4739 8.27113 16.4095 8.13445 16.3917L3.02816 15.7242C2.69958 15.6812 2.46804 15.3801 2.51099 15.0515C2.52056 14.9782 2.54359 14.9074 2.5789 14.8425L5.04031 10.3191C5.1062 10.198 5.12839 10.0579 5.10314 9.92241L4.16 4.85979C4.09931 4.53402 4.3142 4.22074 4.63997 4.16005C4.7126 4.14652 4.78711 4.14652 4.85974 4.16005L9.92237 5.10319C10.0579 5.12843 10.198 5.10625 10.319 5.04036L14.8424 2.57895C15.1335 2.42056 15.4979 2.52812 15.6562 2.81919C15.6916 2.88409 15.7146 2.95495 15.7241 3.02821L16.3916 8.13449C16.4095 8.27118 16.4739 8.39754 16.5739 8.49233L20.3127 12.0337C20.5533 12.2616 20.5636 12.6414 20.3357 12.8819C20.2849 12.9356 20.2246 12.9794 20.1579 13.0111L15.5078 15.2238C15.3833 15.2831 15.283 15.3833 15.2238 15.5078ZM16.0206 17.4349L17.4348 16.0207L21.6775 20.2633L20.2633 21.6775L16.0206 17.4349Z" fill="rgba(255,255,255,1)"></path></svg>
                      <div class="mx-auto pr-6 pl-1">COMPLETE</div>
                    </button>
                  </div>
                  <div class="m-1 pb-[3px]">
                    <button
                      class="medium-button subpixel-antialiased text-[11.5px] tracking-wider flex justify-between items-center"
                      id="btn-prettify">
                      <svg class="ml-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M8 19.9966V14.9966H10V19.9966H19V12.9966H5V19.9966H8ZM4 10.9966H20V7.99658H14V3.99658H10V7.99658H4V10.9966ZM3 20.9966V12.9966H2V6.99658C2 6.4443 2.44772 5.99658 3 5.99658H8V2.99658C8 2.4443 8.44772 1.99658 9 1.99658H15C15.5523 1.99658 16 2.4443 16 2.99658V5.99658H21C21.5523 5.99658 22 6.4443 22 6.99658V12.9966H21V20.9966C21 21.5489 20.5523 21.9966 20 21.9966H4C3.44772 21.9966 3 21.5489 3 20.9966Z" fill="rgba(255,255,255,1)"></path></svg>
                      <div class="mx-auto pr-6 pl-1">PRETTIFY</div>
                    </button>
                  </div>
                  <div class="m-1 pb-[3px]">
                    <button
                      class="medium-button subpixel-antialiased text-[11.5px] tracking-wider flex justify-between items-center"
                      id="btn-optimize">
                      <svg class="ml-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><path d="M13 9H21L11 24V15H4L13 0V9ZM11 11V7.22063L7.53238 13H13V17.3944L17.263 11H11Z" fill="rgba(255,255,255,1)"></path></svg>
                      <div class="mx-auto pr-6 pl-1">OPTIMIZE</div>
                    </button>
                  </div>
                </div>
              </div>
              <script>
                document.getElementById('closeButton').addEventListener('click', function () {
                  document.getElementById('warningDiv').style.display = 'none';
                });
              </script>
            </div>
          </div>
        </div>
      </div>
      </div>
      <div id="analyze-content" style="display: none;">
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
              <button class="big-button subpixel-antialiased text-[12px] tracking-wider flex items-center"
                id="btn-behavior">
                <svg xmlns="http://www.w3.org/2000/svg" class="ml-2" viewBox="0 0 24 24" width="16" height="16"><path d="M6 21.5C4.067 21.5 2.5 19.933 2.5 18C2.5 16.067 4.067 14.5 6 14.5C7.5852 14.5 8.92427 15.5538 9.35481 16.9991L15 16.9993V15L17 14.9993V9.24332L14.757 6.99932H9V8.99996H3V2.99996H9V4.99932H14.757L18 1.75732L22.2426 5.99996L19 9.24132V14.9993L21 15V21H15V18.9993L9.35499 19.0002C8.92464 20.4458 7.58543 21.5 6 21.5ZM6 16.5C5.17157 16.5 4.5 17.1715 4.5 18C4.5 18.8284 5.17157 19.5 6 19.5C6.82843 19.5 7.5 18.8284 7.5 18C7.5 17.1715 6.82843 16.5 6 16.5ZM19 17H17V19H19V17ZM18 4.58575L16.5858 5.99996L18 7.41418L19.4142 5.99996L18 4.58575ZM7 4.99996H5V6.99996H7V4.99996Z" fill="rgba(255,255,255,1)"></path></svg>
                <div class="mx-auto pr-6">BEHAVIOR</div>
              </button>
            </div>
            <div class="m-1 w-full">
              <button class="big-button subpixel-antialiased text-[12px] tracking-wider flex items-center" id="btn-review">
              <svg xmlns="http://www.w3.org/2000/svg" class="ml-2" viewBox="0 0 24 24" width="16" height="16"><path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748ZM12.1779 7.17624C11.4834 7.48982 11 8.18846 11 9C11 10.1046 11.8954 11 13 11C13.8115 11 14.5102 10.5166 14.8238 9.82212C14.9383 10.1945 15 10.59 15 11C15 13.2091 13.2091 15 11 15C8.79086 15 7 13.2091 7 11C7 8.79086 8.79086 7 11 7C11.41 7 11.8055 7.06167 12.1779 7.17624Z" fill="rgba(255,255,255,1)"></path></svg>
                <div class="mx-auto pr-6">REVIEW</div>
              </button>
            </div>
          </div>
          <div id="warningDiv" class="relative bg-[#6e62e9] bg-opacity-15 mb-3 rounded-lg z-50">
            <div class="flex items-center justify-between">
              <p class="text-left subpixel-antialiased text-[11px] text-[rgba(255,255,255,0.9)] px-4">
              ⓘ Since AI-powered analysis may propose several solutions; ensure each is properly reviewed.
              </p>
              <button id="closeButton" class="bg-transparent rounded pr-3">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path fill-rule="evenodd" clip-rule="evenodd"
                    d="M6.57084 0.75C6.39072 0.75 6.21798 0.821547 6.09061 0.948908L4.00001 3.03971L1.9101 0.949265C1.78274 0.821905 1.60999 0.750357 1.42987 0.750357C1.24975 0.750357 1.07701 0.821905 0.94964 0.949265C0.822271 1.07663 0.750714 1.24937 0.750714 1.42949C0.750714 1.6096 0.822289 1.78235 0.94964 1.90971L3.03952 4.00012L0.948926 6.08993C0.821558 6.21729 0.75 6.39003 0.75 6.57015C0.75 6.75028 0.821558 6.92302 0.948926 7.05038C1.07629 7.17774 1.24904 7.24929 1.42916 7.24929C1.60928 7.24929 1.78202 7.17774 1.90939 7.05038L3.99994 4.96061L6.0899 7.05109C6.21726 7.17845 6.39001 7.25 6.57013 7.25C6.75025 7.25 6.92299 7.17845 7.05036 7.05109C7.17773 6.92373 7.24929 6.75099 7.24929 6.57087C7.24929 6.39075 7.17773 6.218 7.05036 6.09064L4.96044 4.00019L7.05107 1.90936C7.17844 1.78199 7.25 1.60925 7.25 1.42913C7.25 1.24901 7.17844 1.07627 7.05107 0.948908C6.92371 0.821547 6.75096 0.75 6.57084 0.75Z"
                    fill="#C0B9FF" />
                </svg>
              </button>
            </div>
          </div>
          <script>
            document.getElementById('closeButton').addEventListener('click', function () {
              document.getElementById('warningDiv').style.display = 'none';
            });
          </script>
        </div>
      </div>
      </div>
      </div>
      </div>
      <div id="generate-content" style="display: none;">
      <div class="flex-container">
      <details>
        <summary class="big-text">Translator</summary>
        <div class="pt-4">
        <div class="div-style-container">
          <span class="small-text">Translate to</span>
          <select class="documentation-style-dropdown" id="translate-dropdown">
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="c">C</option>
          <option value="c++">C++</option>
          <option value="c#">C#</option>
          <option value="php">PHP</option>
          <option value="typescript">TypeScript</option>
          <option value="shell">Shell</option>
          <option value="sql">SQL</option>
          <option value="go">Go</option>
          <option value="swift">Swift</option>
          <option value="kotlin">Kotlin</option>
          <option value="ruby">Ruby</option>
          <option value="rust">Rust</option>
          <option value="r">R</option>
          <option value="dart">Dart</option>
          <option value="matlab">MATLAB</option>
          <option value="perl">Perl</option>
          <option value="bash">Bash</option>
          <option value="powershell">PowerShell</option>
          <option value="groovy">Groovy</option>
          <option value="vba">VBA</option>
          <option value="lua">Lua</option>
          <option value="haskell">Haskell</option>
          <option value="scala">Scala</option>
          <option value="f#">F#</option>
          <option value="objective-c">Objective-C</option>
          <option value="elixir">Elixir</option>
          <option value="clojure">Clojure</option>
          <option value="julia">Julia</option>
          <option value="delphi">Delphi</option>
          <option value="abap">ABAP</option>
          <option value="apex">Apex</option>
          <option value="awk">AWK</option>
          <option value="ocaml">OCaml</option>
          <option value="elm">Elm</option>
          <option value="nim">Nim</option>
          <option value="d">D</option>
          <option value="verilog">Verilog</option>
          <option value="vhdl">VHDL</option>
          <option value="haxe">Haxe</option>
          <option value="gdscript">GDScript</option>          
          </select>
        </div>
        <button class="generate-button text-[11.5px] tracking-wide" style="display: flex; align-items: center;" id="generate-convert-code">
        <svg class="mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M16 16V12L21 17L16 22V18H4V16H16ZM8 2V5.999L20 6V8H8V12L3 7L8 2Z" fill="rgba(255,255,255,1)"></path></svg>
          Convert Code
        </button>
      </div>
      </div>
      </details>
        <div class="flex-container">
        <details>
          <summary class="big-text">Unit Testing</summary>
          <div class="pt-4">
        <div class="div-style-container">
          <span class="small-text">Testing framework</span>
          <select class="testing-framework-dropdown" id="tests-dropdown">
          <option value="suitable">Auto</option>
            <option value="jest">Jest</option>
            <option value="unittest">Unittest</option>
            <option value="mocha">Mocha</option>
            <option value="rspec">RSpec</option>
            <option value="pytest">Pytest</option>
            <option value="cucumber">Cucumber</option>
            <option value="junit">JUnit</option>
            <option value="phpunit">PHPUnit</option>
            <option value="karma">Karma</option>
            <option value="jasmine">Jasmine</option>
            <option value="testng">TestNG</option>
            <option value="nunit">NUnit</option>
            <option value="mstest">MSTest</option>
            <option value="xunit">xUnit</option>
            <option value="mockito">Mockito</option>
          </select>
        </div>
        <div class="div-style-container">
          <div class="relative inline-block">
            <div class="relative group inline-block">
              <span class="small-text flex items-center">
                <span class="mr-1">AI instructions</span>
                <svg xmlns="http://www.w3.org/2000/svg" class="icon ml-auto" viewBox="0 0 24 24" width="12" height="12"><path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 7H13V9H11V7ZM11 11H13V17H11V11Z" fill="rgba(121,108,255,1)"></path></svg>
              </span>
              </span>
              <div
                class="invisible group-hover:visible absolute left-30 w-[260px] bottom-full mb-2 bg-[#6e62e9] p-3 rounded-lg text-[11.5px] text-white shadow-lg transform hover:scale-105 transition-transform duration-200">
                Optionally—add specific instructions for testing (purpose, layout, style, etc...). Speak as you would to a
                dev teammate.
              </div>
            </div>
          </div>
          <input class="input-small-spark" placeholder="E.g., focus on exceptions" id="tests-instructions">
        </div>
        <button class="generate-button text-[11.5px] tracking-wide" style="display: flex; align-items: center;" id="generate-generate-tests">
        <svg xmlns="http://www.w3.org/2000/svg" class="mr-1" viewBox="0 0 24 24" width="12" height="12"><path d="M15.9994 2V4H14.9994V7.24291C14.9994 8.40051 15.2506 9.54432 15.7357 10.5954L20.017 19.8714C20.3641 20.6236 20.0358 21.5148 19.2836 21.8619C19.0865 21.9529 18.8721 22 18.655 22H5.34375C4.51532 22 3.84375 21.3284 3.84375 20.5C3.84375 20.2829 3.89085 20.0685 3.98181 19.8714L8.26306 10.5954C8.74816 9.54432 8.99939 8.40051 8.99939 7.24291V4H7.99939V2H15.9994ZM13.3873 10.0012H10.6115C10.5072 10.3644 10.3823 10.7221 10.2371 11.0724L10.079 11.4335L6.12439 20H17.8734L13.9198 11.4335C13.7054 10.9691 13.5276 10.4902 13.3873 10.0012ZM10.9994 7.24291C10.9994 7.49626 10.9898 7.7491 10.9706 8.00087H13.0282C13.0189 7.87982 13.0119 7.75852 13.0072 7.63704L12.9994 7.24291V4H10.9994V7.24291Z" fill="rgba(255,255,255,1)"></path></svg>
          Generate Tests
        </button>
      </div>
          </div>
        </details>    
        <div class="flex-container">
        <details>
          <summary class="big-text">Custom Functions</summary>
          <div class="pt-4">
          <div class="div-style-container">
            <span class="small-text">Language</span>
            <select class="documentation-style-dropdown" id="function-dropdown">
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
          <option value="c">C</option>
          <option value="c++">C++</option>
          <option value="c#">C#</option>
          <option value="php">PHP</option>
          <option value="typescript">TypeScript</option>
          <option value="shell">Shell</option>
          <option value="sql">SQL</option>
          <option value="go">Go</option>
          <option value="swift">Swift</option>
          <option value="kotlin">Kotlin</option>
          <option value="ruby">Ruby</option>
          <option value="rust">Rust</option>
          <option value="r">R</option>
          <option value="dart">Dart</option>
          <option value="matlab">MATLAB</option>
          <option value="perl">Perl</option>
          <option value="bash">Bash</option>
          <option value="powershell">PowerShell</option>
          <option value="groovy">Groovy</option>
          <option value="vba">VBA</option>
          <option value="lua">Lua</option>
          <option value="haskell">Haskell</option>
          <option value="scala">Scala</option>
          <option value="f#">F#</option>
          <option value="objective-c">Objective-C</option>
          <option value="elixir">Elixir</option>
          <option value="clojure">Clojure</option>
          <option value="julia">Julia</option>
          <option value="delphi">Delphi</option>
          <option value="abap">ABAP</option>
          <option value="apex">Apex</option>
          <option value="awk">AWK</option>
          <option value="ocaml">OCaml</option>
          <option value="elm">Elm</option>
          <option value="nim">Nim</option>
          <option value="d">D</option>
          <option value="verilog">Verilog</option>
          <option value="vhdl">VHDL</option>
          <option value="haxe">Haxe</option>
          <option value="gdscript">GDScript</option> 
            </select>
          </div>
          <div class="div-style-container">
            <span class="small-text">Objective</span>
            <input class="input-small-target" placeholder="E.g., calculate rectangle" id="function-objective">
          </div>
          <div class="div-style-container">
            <span class="small-text">Inputs</span>
            <input class="input-small-in" placeholder="E.g., width, height" id="function-inputs">
          </div>
          <div class="div-style-container">
            <span class="small-text">Outputs</span>
            <input class="input-small-out" placeholder="E.g., area value" id="function-outputs">
          </div>
          <button class="generate-button text-[11.5px] tracking-wide" style="display: flex; align-items: center;" id="generate-generate-code">
          <svg class="mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M24 12L18.3431 17.6569L16.9289 16.2426L21.1716 12L16.9289 7.75736L18.3431 6.34315L24 12ZM2.82843 12L7.07107 16.2426L5.65685 17.6569L0 12L5.65685 6.34315L7.07107 7.75736L2.82843 12ZM9.78845 21H7.66009L14.2116 3H16.3399L9.78845 21Z" fill="rgba(255,255,255,1)"></path></svg>
            Generate Code
          </button>
        </div>
        </div>
        </details>
        <script src="${scriptUri}"></script>
        <script>
          // Tab functionality
          const chatTab = document.getElementById('chat-tab');
          const analyzetab = document.getElementById('analyze-tab');
          const generatetab = document.getElementById('generate-tab');
          const modifyTab = document.getElementById('modify-tab');
          const chatContent = document.getElementById('chat-content');
          const analyzecontent = document.getElementById('analyze-content');
          const generatecontent = document.getElementById('generate-content');
          const modifyContent = document.getElementById('modify-content');
          chatTab.addEventListener('click', () => {
            chatTab.classList.add('active');
            analyzetab.classList.remove('active');
            generatetab.classList.remove('active');
            modifyTab.classList.remove('active');
            chatContent.style.display = 'block';
            analyzecontent.style.display = 'none';
            generatecontent.style.display = 'none';
            modifyContent.style.display = 'none';
          });
          analyzetab.addEventListener('click', () => {
            chatTab.classList.remove('active');
            analyzetab.classList.add('active');
            generatetab.classList.remove('active');
            modifyTab.classList.remove('active');
    
            chatContent.style.display = 'none';
            analyzecontent.style.display = 'block';
            generatecontent.style.display = 'none';
            modifyContent.style.display = 'none';
          });
          generatetab.addEventListener('click', () => {
            chatTab.classList.remove('active');
            analyzetab.classList.remove('active');
            generatetab.classList.add('active');
            modifyTab.classList.remove('active');
            chatContent.style.display = 'none';
            analyzecontent.style.display = 'none';
            generatecontent.style.display = 'block';
            modifyContent.style.display = 'none';
          });
          modifyTab.addEventListener('click', () => {
            chatTab.classList.remove('active');
            analyzetab.classList.remove('active');
            generatetab.classList.remove('active');
            modifyTab.classList.add('active');
            chatContent.style.display = 'none';
            analyzecontent.style.display = 'none';
            generatecontent.style.display = 'none';
            modifyContent.style.display = 'block';
          });
        </script>
      </div>
      <div id="loader" class="hidden w-full bg-[rgba(70,57,204,0.15)]">
        <div id="loadingBar" class="h-full bg-[rgba(70,57,204,0.85)]" style="loading-bar"></div>
      </div>
      <div class="flex items-center space-x-2 py-3">
        <button class="flex items-center text-[10px] pl-3 text-[#d3ceff] button-with-icon" id="clear">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M17 6H22V8H20V21C20 21.5523 19.5523 22 19 22H5C4.44772 22 4 21.5523 4 21V8H2V6H7V3C7 2.44772 7.44772 2 8 2H16C16.5523 2 17 2.44772 17 3V6ZM18 8H6V20H18V8ZM9 11H11V17H9V11ZM13 11H15V17H13V11ZM9 4V6H15V4H9Z" fill="rgba(211,206,255,1)"></path></svg>
          <span style="letter-spacing:0.5px;">Clear</span>
        </button>
        <button class="flex items-center text-[10px] pl-3 text-[#d3ceff] button-with-icon" id="regenerate">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M5.46257 4.43262C7.21556 2.91688 9.5007 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C9.84982 4 7.89777 4.84827 6.46023 6.22842L5.46257 4.43262ZM18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 9.86386 2.66979 7.88416 3.8108 6.25944L7 12H4C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z" fill="rgba(211,206,255,1)"></path></svg>
        <span style="letter-spacing:0.5px;">Regenerate</span>
        </button>
        <button class="flex items-center text-[10px] pl-3 text-[#d3ceff] button-with-icon" id="terminal">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"><path d="M3 3H21C21.5523 3 22 3.44772 22 4V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V4C2 3.44772 2.44772 3 3 3ZM4 5V19H20V5H4ZM12 15H18V17H12V15ZM8.66685 12L5.83842 9.17157L7.25264 7.75736L11.4953 12L7.25264 16.2426L5.83842 14.8284L8.66685 12Z" fill="rgba(211,206,255,1)"></path></svg>
        <span style="letter-spacing:0.5px;">SecureCode-Terminal</span>
        </button>
      </div>
      <div id="response" class="py-2 px-3 mb-3 subpixel-antialiased rounded bg-[rgba(0,0,0,0.1)] text-[12]">
          <p class="has-line-data" data-line-start="0" data-line-end="3">Hey! I’m SecureCode 🤖<br>
          An assistant designed to help you with queries for an overall better, much smarter workflow 🧠<br><br>
          Here’s some of the many ways I can help:</p>
        <p class="has-line-data" data-line-start="4" data-line-end="10">
          • Summarize package docs 📚<br>
          • Answer code related queries 🔎<br>
          • Optimize and solve code issues 🛠️<br>
          • Refactor and suggest reliable code ✅<br>
          • Generate code to fast-track your work 🚀</p>
        <p class="has-line-data" data-line-start="11" data-line-end="12">Explore the 'Analyze', 'Modify', and 'Generate'
          tabs for code improvements and useful extras. Utilize 'SecureCode-Terminal' for command line assistance.
          Right-click on code snippets for quick, robust AI tools.</p>
        <p class="has-line-data" data-line-start="13" data-line-end="14">Let’s get started, I’m listening 😊</p>
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