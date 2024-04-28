import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.util.Arrays;

public class Main {

    // The key used for AES encryption. This should be kept secret.
    static byte[] key = {0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c};

    // The initialization vector used for AES encryption.
    static byte[] iv = {0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f};

    // Function to encrypt a given string using AES and return the ciphertext.
    static byte[] aesEncrypt(String plaintext) throws Exception {
        SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, new IvParameterSpec(iv));
        return cipher.doFinal(plaintext.getBytes());
    }

    public static void main(String[] args) throws Exception {
        // Get the plaintext to encrypt.
        String plaintext = "Hello, world!";

        // Encrypt the plaintext using AES.
        byte[] ciphertext = aesEncrypt(plaintext);

        // Send the ciphertext to three different persons.
        // Here, we are just printing the ciphertext to the console.
        System.out.print("Ciphertext 1: ");
        for (byte b : ciphertext) {
            System.out.print(b + " ");
        }
        System.out.println();

        System.out.print("Ciphertext 2: ");
        for (byte b : ciphertext) {
            System.out.print(b + " ");
        }
        System.out.println();

        System.out.print("Ciphertext 3: ");
        for (byte b : ciphertext) {
            System.out.print(b + " ");
        }
        System.out.println();
    }
}
