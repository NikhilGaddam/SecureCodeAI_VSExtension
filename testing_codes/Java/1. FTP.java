import java.io.*;
import java.net.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class FileServer {

    private static final int THREAD_POOL_SIZE = 10;

    public static void main(String[] args) {
        if (args.length != 2) {
            System.err.println("Usage: java FileServer <port> <file_directory>");
            return;
        }

        int port = Integer.parseInt(args[0]);
        String fileDirectory = args[1];

        ExecutorService executorService = Executors.newFixedThreadPool(THREAD_POOL_SIZE);

        try (ServerSocket serverSocket = new ServerSocket(port)) {
            while (true) {
                Socket clientSocket = serverSocket.accept();
                executorService.submit(new Session(clientSocket, fileDirectory));
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}

class Session implements Runnable {

    private Socket socket;
    private String fileDirectory;

    public Session(Socket socket, String fileDirectory) {
        this.socket = socket;
        this.fileDirectory = fileDirectory;
    }

    @Override
    public void run() {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream()));
             PrintWriter out = new PrintWriter(socket.getOutputStream(), true)) {

            String filename = in.readLine();
            if (filename != null) {
                filename = filename.trim();
                File file = new File(fileDirectory, filename);
                if (file.exists() && file.isFile()) {
                    try (BufferedInputStream fileInputStream = new BufferedInputStream(new FileInputStream(file))) {
                        byte[] buffer = new byte[4096];
                        int bytesRead;
                        while ((bytesRead = fileInputStream.read(buffer)) != -1) {
                            socket.getOutputStream().write(buffer, 0, bytesRead);
                        }
                    }
                } else {
                    out.println("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                }
            }
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            try {
                socket.close();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }
}
