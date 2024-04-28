public class Main {
    public static int getProduct(int[] arr) {
        int product = 1;
        for (int i = 0; i < arr.length; i++) {
            product *= arr[i];
        }
        return product;
    }

    public static void main(String[] args) {
        int[] arr = {2, 3, 5, 7, 11};
        int product = getProduct(arr);
        System.out.println("Product of array elements is: " + product);
    }
}
