import java.util.Scanner;
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        System.out.print("Enter the number of elements in the list: ");
        int n = scanner.nextInt();

        int[] list = new int[n];
        for (int i = 0; i < n; i++) {
            System.out.print("Enter element number " + (i + 1) + ": ");
            list[i] = scanner.nextInt();
        }
        Arrays.sort(list);

        while (true) {
            System.out.println();
            System.out.println("What would you like to do?");
            System.out.println("1. Print the sorted list");
            System.out.println("2. Print a specific element from the list");
            System.out.println("3. Exit the program");
            System.out.print("Enter your choice (1-3): ");

            int choice = scanner.nextInt();

            if (choice == 1) {
                System.out.print("The sorted list is: ");
                for (int i = 0; i < n; i++) {
                    System.out.print(list[i] + " ");
                }
                System.out.println();
            } else if (choice == 2) {
                System.out.print("Enter the index of the element (from 1 to " + n + "): ");
                int index = scanner.nextInt();

                if (index >= 1 && index <= n) {
                    System.out.println("Element number " + index + " is: " + list[index - 1]);
                } else {
                    System.out.println("Invalid index. Please enter a value between 1 and " + n + ".");
                }
            } else if (choice == 3) {
                System.out.println("Goodbye!");
                break;
            } else {
                System.out.println("Invalid choice. Please enter a number between 1 and 3.");
            }
        }

        scanner.close();
    }
}
