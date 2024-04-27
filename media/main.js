// @ts-ignore

// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
  const vscode = acquireVsCodeApi();

  let response = "";

  window.addEventListener("DOMContentLoaded", (event) => {
    const submitButton = document.getElementById("submit-button");
    const promptInput = document.getElementById("prompt-input");

    submitButton.addEventListener("click", (event) => {
      event.preventDefault();
      const promptValue = promptInput.value;
      if (promptValue) {
        vscode.postMessage({
          type: "prompt",
          value: promptValue,
        });
        promptInput.value = "";
      }
    });

    document
      .getElementById("prompt-input")
      .addEventListener("keyup", function (e) {
        // If the key that was pressed was the Enter key
        if (e.keyCode === 13) {
          vscode.postMessage({
            type: "prompt",
            value: this.value,
          });
        }
      });

    const loadingBar = document.getElementById("loading-bar");
    function startLoading() {
      loadingBar.classList.remove("hidden");
      loadingBar.style.width = "0";
      setTimeout(() => {
        loadingBar.style.width = "100%";
      }, 0);
    }

    document.getElementById("clear").addEventListener("click", () => {
      vscode.postMessage({ type: "clear" });
    });

    document.getElementById("regenerate").addEventListener("click", () => {
      vscode.postMessage({ type: "regenerate" });
    });

    // document.getElementById("terminal").addEventListener("click", () => {
    //   vscode.postMessage({ type: "terminal" });
    // });

    // document.getElementById("btn-behavior").addEventListener("click", () => {
    //   vscode.postMessage({ type: "analyze-behavior" });
    // });
    document.getElementById("btn-review").addEventListener("click", () => {
      vscode.postMessage({ type: "analyze-review" });
    });

    // document.getElementById("btn-debug").addEventListener("click", () => {
    //   vscode.postMessage({ type: "modify-debug" });
    // });

    // document.getElementById("btn-document").addEventListener("click", () => {
    //   vscode.postMessage({ type: "modify-document" });
    // });

    // document.getElementById("btn-coverage").addEventListener("click", () => {
    //   vscode.postMessage({ type: "modify-coverage" });
    // });

    // document.getElementById("btn-complete").addEventListener("click", () => {
    //   vscode.postMessage({ type: "modify-complete" });
    // });

    // document.getElementById("btn-prettify").addEventListener("click", () => {
    //   vscode.postMessage({ type: "modify-prettify" });
    // });
    // document.getElementById("btn-optimize").addEventListener("click", () => {
    //   vscode.postMessage({ type: "modify-optimize" });
    // });
    // document
    //   .getElementById("generate-convert-code")
    //   .addEventListener("click", () => {
    //     vscode.postMessage({ type: "generate-convert-code" });
    //   });

    // document
    //   .getElementById("generate-generate-tests")
    //   .addEventListener("click", () => {
    //     vscode.postMessage({ type: "generate-generate-tests" });
    //   });

    // document
    //   .getElementById("generate-generate-code")
    //   .addEventListener("click", () => {
    //     vscode.postMessage({ type: "generate-generate-code" });
    //   });

    // document
    //   .getElementById("translate-dropdown")
    //   .addEventListener("change", (event) => {
    //     const language = event.target.value;
    //     vscode.postMessage({
    //       type: "languageSelected",
    //       value: language,
    //     });
    //   });

    // document
    //   .getElementById("function-dropdown")
    //   .addEventListener("change", (event) => {
    //     const language = event.target.value;
    //     vscode.postMessage({
    //       type: "functionSelected",
    //       value: language,
    //     });
    //   });

    // document
    //   .getElementById("function-objective")
    //   .addEventListener("change", (event) => {
    //     const functionObjective = event.target.value;
    //     vscode.postMessage({
    //       type: "functionObjective",
    //       value: functionObjective,
    //     });
    //   });
    // document
    //   .getElementById("function-inputs")
    //   .addEventListener("change", (event) => {
    //     const functionInputs = event.target.value;
    //     vscode.postMessage({
    //       type: "functionInputs",
    //       value: functionInputs,
    //     });
    //   });
    // document
    //   .getElementById("function-outputs")
    //   .addEventListener("change", (event) => {
    //     const functionOutputs = event.target.value;
    //     vscode.postMessage({
    //       type: "functionOutputs",
    //       value: functionOutputs,
    //     });
    //   });

    // document
    //   .getElementById("tests-dropdown")
    //   .addEventListener("change", (event) => {
    //     const framework = event.target.value;
    //     vscode.postMessage({
    //       type: "frameworkSelected",
    //       value: framework,
    //     });
    //   });
    // document
    //   .getElementById("tests-instructions")
    //   .addEventListener("change", (event) => {
    //     const testsInstructions = event.target.value;
    //     vscode.postMessage({
    //       type: "testsInstructions",
    //       value: testsInstructions,
    //     });
    //   });

    // document
    //   .getElementById("docs-instructions")
    //   .addEventListener("change", (event) => {
    //     const docsInstructions = event.target.value;
    //     console.log("Input value changed. Current value: " + docsInstructions);

    //     vscode.postMessage({
    //       type: "docsInstructions",
    //       value: docsInstructions,
    //     });
    //   });

    // document
    //   .getElementById("generate-generate-docs")
    //   .addEventListener("click", () => {
    //     vscode.postMessage({ type: "generate-generate-docs" });
    //   });

    function stopLoading() {
      loadingBar.style.width = "0";
      setTimeout(() => {
        loadingBar.classList.add("hidden");
      }, 300);
    }
  });

  // Handle messages sent from the extension to the webview
  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "addResponse": {
        response = message.value;
        setResponse();
        break;
      }
      case "clearResponse": {
        response = "";
        break;
      }
      case "setPrompt": {
        document.getElementById("prompt-input").value = message.value;
        break;
      }
      case "startLoading": {
        const loader = document.getElementById("loader");
        const loadingBar = document.getElementById("loadingBar");
        loader.classList.remove("hidden");
        let width = 1;
        const id = setInterval(() => {
          if (width >= 98) {
            clearInterval(id);
          } else {
            width++;
            loadingBar.style.width = width + "%";
          }
        }, 60);
        break;
      }
      case "stopLoading": {
        const loader = document.getElementById("loader");
        loader.classList.add("hidden");
        const loadingBar = document.getElementById("loadingBar");
        loadingBar.style.width = "0"; // reset loading bar width
        break;
      }
    }
  });

  function fixCodeBlocks(response) {
    // Use a regular expression to find all occurrences of the substring in the string
    const REGEX_CODEBLOCK = new RegExp("```", "g");

    let count = 0;
    let result = "";
    let position = 0;

    while ((match = REGEX_CODEBLOCK.exec(response)) != null) {
      count++;
      result += response.slice(position, match.index);

      if (count % 2 === 1) {
        // We are entering a code block
        result += "```";
      } else {
        // We are leaving a code block
        result += "```";
      }
      position = match.index + match[0].length;
    }

    result += response.slice(position);

    if (count % 2 === 1) {
      // If we finished with an unclosed code block, close it
      result += "\n```";
    }

    return result;
  }

  function setResponse() {
    var converter = new showdown.Converter({
      omitExtraWLInCodeBlocks: true,
      simplifiedAutoLink: true,
      excludeTrailingPunctuationFromURLs: true,
      literalMidWordUnderscores: true,
      simpleLineBreaks: true,
    });

    response = fixCodeBlocks(response);

    let html = converter.makeHtml(response);
    html = html.replace(/▸/g, "\n•  ");

    html = html
      .split("\n")
      .map((line) => {
        if (line.includes("ᚦ")) {
          if (line.length > 34) {
            // Apply different style for the line if it's more than 30 characters long
            return line;
          } else {
            return `<div style="display: inline-block; background: #5e50e6; box-shadow: 2px 2px 3px rgba(96, 83, 233, 0.12); border-radius: 50px; padding: 0px 8px !important; margin-top: 18px !important; margin-bottom: 6px !important; color: #FFFFFF; letter-spacing: 0.75px; font-size: 11px; line-height: 12px !important;">
              <span style="display: flex; align-items: center;">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="12" height="12"><path d="M13 19.9381C16.6187 19.4869 19.4869 16.6187 19.9381 13H17V11H19.9381C19.4869 7.38128 16.6187 4.51314 13 4.06189V7H11V4.06189C7.38128 4.51314 4.51314 7.38128 4.06189 11H7V13H4.06189C4.51314 16.6187 7.38128 19.4869 11 19.9381V17H13V19.9381ZM12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12C14 13.1046 13.1046 14 12 14Z" fill="rgba(255,255,255,1)"></path></svg>
                  ${line.replace(/ᚦ/g, "")}
              </span>
          </div><br>`;
          }
        } else {
          return line;
        }
      })
      .join("\n");

    html = html.replace(/ᚦ/g, "");
    document.getElementById("response").innerHTML = html;

    var preCodeBlocks = document.querySelectorAll("pre code");
    for (var i = 0; i < preCodeBlocks.length; i++) {
      preCodeBlocks[i].classList.add(
        "my-1",
        "block",
        "text-[12px]",
        "rounded-md",
        "p-6",
        "mb-12",
        "bg-[#1A1A1B]",
        "w-full",
        "text-[#9A91FF]",
        "overflow-x-scroll"
      );
    }

    var codeBlocks = document.querySelectorAll("code");
    for (var i = 0; i < codeBlocks.length; i++) {
      // Check if the code block is not within a pre element (thus inline)
      if (codeBlocks[i].parentElement.nodeName !== "PRE") {
        // Replace inline code with normal text
        codeBlocks[i].outerHTML = codeBlocks[i].innerText;
      } else {
        // Original code handling code blocks
        if (codeBlocks[i].innerText.startsWith("Copy code")) {
          codeBlocks[i].innerText = codeBlocks[i].innerText.replace(
            "Copy code",
            ""
          );
        }

        codeBlocks[i].classList.add(
          "inline-flex",
          "max-w-full",
          "overflow-hidden",
          "rounded-md",
          "cursor-pointer"
        );

        codeBlocks[i].addEventListener("click", function (e) {
          e.preventDefault();
          vscode.postMessage({
            type: "codeSelected",
            value: this.innerText,
          });
        });

        const d = document.createElement("div");
        d.innerHTML = codeBlocks[i].innerHTML;
        codeBlocks[i].innerHTML = null;
        codeBlocks[i].appendChild(d);
        d.classList.add("code");
      }
    }

    microlight.reset("code");

    //document.getElementById("response").innerHTML = document.getElementById("response").innerHTML.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  // document.getElementById("send-button").addEventListener("click", () => {
  //   vscode.postMessage({ type: "generate-convert-code" });
  // });

  // Listen for keyup events on the prompt input element
})();
