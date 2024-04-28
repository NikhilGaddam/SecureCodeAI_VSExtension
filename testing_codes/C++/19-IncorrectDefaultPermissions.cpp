#include <iostream>
#include <fstream>
#include <string>
#include <sys/stat.h>

const std::string CONFIG_FILE = "config.cfg";
const std::string DEFAULT_CONFIG = "setting1=true\nsetting2=default_value\n";

void applyConfig(const std::string& config) {
    // Apply the configuration to the system
    // Placeholder for actual configuration application logic
    std::cout << "Applying configuration: " << config << std::endl;
}

void loadOrInitializeConfig() {
    struct stat buffer;   
    if(stat(CONFIG_FILE.c_str(), &buffer) != 0) {
        // The vulnerability is here: by default, the file may be created with permissions that are too permissive
        std::ofstream configFile(CONFIG_FILE);
        configFile << DEFAULT_CONFIG;
        configFile.close();
        std::cout << "No configuration file found. Created a new one with default settings." << std::endl;
    }

    std::ifstream configFile(CONFIG_FILE);
    std::string config((std::istreambuf_iterator<char>(configFile)), std::istreambuf_iterator<char>());
    applyConfig(config);
}

int main() {
    loadOrInitializeConfig();
    return 0;
}
