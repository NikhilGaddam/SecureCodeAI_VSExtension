# Import required libraries
import binascii

# Hard-coded key for "encrypting" the magic number
# This represents the vulnerability, as the key should not be hard-coded.
ENCRYPTION_KEY = "mysecretkey"

def encrypt_magic_number(magic_number):
    # This function simulates encryption by XORing the magic number with a key
    encrypted = "".join(chr(ord(char) ^ ord(ENCRYPTION_KEY[i % len(ENCRYPTION_KEY)])) for i, char in enumerate(magic_number))
    return encrypted

def check_image_file(file_path):
    # Open the file in binary mode
    with open(file_path, 'rb') as file:
        # Read the first 4 bytes to get the magic number
        magic_number = file.read(4)
        encrypted_magic_number = encrypt_magic_number(magic_number)
        

        decrypted_magic_number = encrypt_magic_number(encrypted_magic_number)
        

        print("Magic number:", binascii.hexlify(decrypted_magic_number))
        

        return True
