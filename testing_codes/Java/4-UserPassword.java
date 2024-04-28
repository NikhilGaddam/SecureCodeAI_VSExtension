import java.util.Scanner;
import java.util.regex.*;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.print("Input the login: ");
        String login = scanner.next();
        System.out.print("Input the password: ");
        String password = scanner.next();
        Pattern pattern = Pattern.compile("(" + login + ")");
        Matcher matcher = pattern.matcher(password);
        if (matcher.find()) {
            System.out.println("The login cannot be included in the password.");
        } else {
            System.out.println("Password is valid.");
        }
        scanner.close();
    }
}
