import java.util.Random;

public class PasswordGenerator {
    public static void main(String[] args) {
        int passwordLength = 10; // length of the password

        // Create a random number generator
        Random rng = new Random();

        StringBuilder password = new StringBuilder();
        for (int i = 0; i < passwordLength; i++) {
            // Generate a random number for the password
            int randomNumber = rng.nextInt(10);
            password.append(randomNumber);
        }

        System.out.println("Generated password: " + password.toString());
    }
}
