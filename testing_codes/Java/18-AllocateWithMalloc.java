import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        System.out.print("Enter the size of the array: ");
        int size = scanner.nextInt();
        int[] arr = new int[size];

        System.out.println("Memory allocated successfully.");

        // Do something with the allocated memory here...

        // Freeing memory is handled automatically by Java's garbage collector.
    }
}
