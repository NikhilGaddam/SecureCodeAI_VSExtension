import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.print("Enter a string: ");
        String str = scanner.nextLine();

        int len = str.length();
        int j = 0;
        char[] modifiedStr = new char[len];
        for (int i = 0; i < len; i++) {
            if (str.charAt(i) != '\\') {
                modifiedStr[j] = str.charAt(i);
                j++;
            }
        }
        String result = new String(modifiedStr, 0, j);
    }
}
