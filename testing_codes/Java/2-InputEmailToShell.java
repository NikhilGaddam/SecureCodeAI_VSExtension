import java.util.Scanner;
import java.io.IOException;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.print("Enter your email address: ");
        String email = scanner.nextLine();

        if (!email.contains("@")) {
            System.out.println("Invalid Email");
            System.exit(1);
        }

        try {
            ProcessBuilder processBuilder = new ProcessBuilder("program.py", email);
            processBuilder.start();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
