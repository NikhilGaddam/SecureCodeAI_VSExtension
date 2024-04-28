import java.io.*;
import java.nio.file.*;
import java.util.*;

public class ConfigLoader {
    private static final String CONFIG_FILE = "config.properties";
    private static final Properties DEFAULT_CONFIG;
    
    static {
        DEFAULT_CONFIG = new Properties();
        DEFAULT_CONFIG.setProperty("setting1", "true");
        DEFAULT_CONFIG.setProperty("setting2", "default_value");
    }

    public static void applyConfig(Properties config) {
        // Apply the configuration to the system
        // Placeholder for actual configuration application logic
        config.list(System.out);
    }

    public static Properties loadOrInitializeConfig() throws IOException {
        File configFile = new File(CONFIG_FILE);
        Properties config = new Properties();

        if (!configFile.exists()) {
            // The vulnerability is here: by default, the file may be created with permissions that are too permissive
            try (OutputStream output = new FileOutputStream(CONFIG_FILE)) {
                DEFAULT_CONFIG.store(output, "Default configuration");
                System.out.println("No configuration file found. Created a new one with default settings.");
            }
        }

        try (InputStream input = new FileInputStream(CONFIG_FILE)) {
            config.load(input);
        }
        return config;
    }

    public static void main(String[] args) {
        try {
            Properties config = loadOrInitializeConfig();
            applyConfig(config);
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }
}
