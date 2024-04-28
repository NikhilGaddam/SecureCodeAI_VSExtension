import java.util.zip.*;
import java.io.*;

public class ZipReader {
    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("Please specify a .zip file as an argument.");
            return;
        }

        try (ZipFile zipFile = new ZipFile(args[0])) {
            Enumeration<? extends ZipEntry> entries = zipFile.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) continue;

                try (InputStream stream = zipFile.getInputStream(entry)) {
                    byte[] buffer = new byte[(int) entry.getSize()];
                    int readBytes = stream.read(buffer);

                    // Perform some manipulation on the file data
                    // ...

                } catch (IOException e) {
                    System.err.println("Failed to extract file: " + entry.getName());
                }
            }
        } catch (IOException e) {
            System.err.println("Failed to open the .zip file.");
        }
    }
}
