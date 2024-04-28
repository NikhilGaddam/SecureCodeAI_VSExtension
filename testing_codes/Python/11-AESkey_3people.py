from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes

# The key used for AES encryption. This should be kept secret.
key = bytes([0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c])

# The initialization vector used for AES encryption.
iv = bytes([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f])

# Function to encrypt a given string using AES and return the ciphertext.
def aes_encrypt(plaintext):
    cipher = AES.new(key, AES.MODE_CBC, iv)
    return cipher.encrypt(plaintext)

def main():
    # Get the plaintext to encrypt.
    plaintext = "Hello, world!"

    # Encrypt the plaintext using AES.
    ciphertext = aes_encrypt(plaintext)

    # Send the ciphertext to three different persons.
    # Here, we are just printing the ciphertext to the console.
    print("Ciphertext 1:", end=" ")
    for c in ciphertext:
        print(hex(c), end=" ")
    print()

    print("Ciphertext 2:", end=" ")
    for c in ciphertext:
        print(hex(c), end=" ")
    print()

    print("Ciphertext 3:", end=" ")
    for c in ciphertext:
        print(hex(c), end=" ")
    print()

if __name__ == "__main__":
    main()
