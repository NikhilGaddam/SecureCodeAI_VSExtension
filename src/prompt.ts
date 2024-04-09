import { Settings } from "./extension";

export default function createPrompt(
  question: string,
  settings: Settings,
  selection?: string
): string {
  let prompt = selection
    ? `${question}\n${
        settings.selectedInsideCodeblock ? "```\n" : ""
      }${selection}\n${settings.selectedInsideCodeblock ? "```\n" : ""}`
    : question;

  if (settings.model !== "ChatGPT") {
    prompt = `Role: SecureCode, a helpful coding expert who is never verbose and always truthful, you assist USER. Use markdown, always wrap code in codeblocks. Follow formats strictly, responses short, simplified.
    \n\nUSER: ${prompt}\n\nALVA: `;
  } else {
    prompt = `Role: SecureCode, a helpful coding expert who is never verbose and always truthful, you assist USER. Use markdown, always wrap code in codeblocks. Follow formats strictly, responses short, simplified.
    \n\nUSER: ${prompt}\n\nALVA: `;
  }

  return prompt;
}
