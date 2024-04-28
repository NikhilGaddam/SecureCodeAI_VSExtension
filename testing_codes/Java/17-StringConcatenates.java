import java.util.Arrays;

public class StringConcatenation {
    public static void concatenateStrings(byte[] str1, int size1, byte[] str2, int size2, byte[] result) {
        System.arraycopy(str1, 0, result, 0, size1);
        System.arraycopy(str2, 0, result, size1, size2);
    }

    public static void main(String[] args) {
        byte[] str1 = "Hello, ".getBytes();
        byte[] str2 = "world!".getBytes();
        byte[] result = new byte[str1.length + str2.length];
        concatenateStrings(str1, str1.length, str2, str2.length, result);
        System.out.println(new String(result));
    }
}
