import os
import subprocess
import argparse
import openai
import re

# Check if running on Windows
is_windows = os.name == 'nt'

# Set history file
histfile = os.path.join(os.path.expanduser("~"), ".cli_tool_hist")

if not is_windows:
    import readline

    def load_history():
        if os.path.exists(histfile):
            readline.read_history_file(histfile)

    def save_history():
        readline.write_history_file(histfile)

def chat_with_model(prompt, api_key):
    try:
        openai.api_key = api_key
        model = "gpt-3.5-turbo"
        system_msg = {
            "role": "system",
            "content": "You are a helpful assistant that suggests valid Unix terminal commands even with little context, you like writing creative git commit and pull request messages. Return commands without explanations and chain multiple commands with '&&', You only answer with command suggestions, you do not answer anything unrelated. for everything that is not a command and unrelated language prompts answer 'CAN'T SUGGEST COMMAND.'. Query: " if not is_windows else "You are a helpful assistant that suggests valid Windows cmd commands even with little context, you like writing creative git commit and pull request messages. Return commands without explanations and chain multiple commands with '&', You only answer with command suggestions, you do not answer anything unrelated. for everything that is not a command and unrelated language prompts answer 'CAN'T SUGGEST COMMAND.'. Query: "
        }
        user_msg = {
            "role": "user",
            "content": prompt
        }
        response = openai.ChatCompletion.create(
            model=model,
            messages=[system_msg, user_msg],
            max_tokens=150,
            temperature=0.6
        )

        response_msg = response['choices'][0]['message']['content']

        suggested_command = response_msg.strip()

        if suggested_command:
            command_chainer = ' && ' if not is_windows else ' & '
            return suggested_command.replace('\n', command_chainer)
        else:
            return "CAN'T SUGGEST COMMAND."
    except Exception as e:
        print(f"API ERROR:\n\nHave you set OpenAI API key? please go to Preferences -> Settings -> Alva: API Key")
        return None


def run_command(command):
    if command.startswith('cd '):
        try:
            os.chdir(command.split('cd ',1)[1])
        except Exception as e:
            print(f"ERROR CHANGING DIRECTORY: {e}")
    else:
        try:
            result = subprocess.run(command, shell=True,
                                    text=True, capture_output=True)

            if result.returncode != 0:
                print(result.stderr)
                print(result.stdout)
            else:
                print(result.stdout)
        except Exception as e:
            print(f"ERROR RUNNING COMMAND: {e}")


def command_interface(prompt, confirmation_required, api_key):
    suggested_command = chat_with_model(prompt, api_key)

    if suggested_command is None:
        print("\nAPI ERROR. SKIPPED.")
    elif suggested_command == "CAN'T SUGGEST COMMAND." or suggested_command.upper() == "N/A":
        print("\nNO VALID SUGGESTION. SKIPPED.")
    else:
        print(f"\n⚡SUGGESTED COMMAND: {suggested_command}")

        if confirmation_required:
            confirmation = input("\nAPPLY? (Y/N, ENTER = Y): ")
            if confirmation.lower() in ['y', '']:
                run_command(suggested_command)
            elif confirmation.lower() == 'n':
                print("\nSKIPPED.")
            else:
                print("\nINVALID INPUT. SKIPPED.")
        else:
            run_command(suggested_command)


def cli_tool(confirmation_required, api_key, start_directory):
    # Clear the console screen
    os.system('cls' if is_windows else 'clear')

    os.chdir(start_directory)

    print(f"🤖 I'm Alva-CLI, your friendly terminal assistant turning wishes into commands - literally.\n\nSimply write commands as usual or start with '?' and describe what you need.\n")
    if not is_windows:
        load_history()

    while True:
        try:
            current_dir = os.getcwd()
            user_input = input(f"\n{current_dir} (Alva-CLI)> ")
            
            # Check if user wants to exit
            if user_input.strip().lower() == "exit":
                print("\n\nEXITING Alva-CLI...")
                if not is_windows:
                    save_history()
                break
                
            elif user_input.strip().startswith('?'):
                command_interface(user_input[1:].strip(), confirmation_required, api_key)
            else:
                run_command(user_input)

        except KeyboardInterrupt:
            print("\n\nEXITING Alva-CLI...")
            if not is_windows:
                save_history()
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='AI assisted CLI helper tool.')
    parser.add_argument('-c', '--confirm', action='store_true',
                        help='Requires confirmation before running each command')
    parser.add_argument('-k', '--key', type=str,
                        required=True, help='Your OpenAI API key')
    parser.add_argument('-d', '--dir', type=str, default='.',
                        help='The starting directory for the CLI tool')
    args = parser.parse_args()

    cli_tool(args.confirm, args.key, args.dir)
