import os
import json

CONFIG_FILE = 'config.json'
DEFAULT_CONFIG = {
    'setting1': True,
    'setting2': 'default_value'
}

def apply_config(config):
    # This function would apply the configuration to the system
    # For the sake of this example, we will just print the configuration
    print("Applying configuration:", config)

def load_or_initialize_config():
    if not os.path.exists(CONFIG_FILE):
        # The vulnerability is here: by default, the file may be created with permissions that are too permissive
        with open(CONFIG_FILE, 'w') as file:
            json.dump(DEFAULT_CONFIG, file)
            print(f"No configuration file found. Created a new one with default settings.")
    
    # Loading the configuration file
    with open(CONFIG_FILE, 'r') as file:
        config = json.load(file)
        return config

# Main execution
if __name__ == "__main__":
    config = load_or_initialize_config()
    apply_config(config)
