from Crypto.Cipher import AES
from Crypto.Util.Padding import pad
from base64 import b64encode

def encrypt_password(password, key):
    cipher = AES.new(key.encode(), AES.MODE_CBC, iv=key.encode())
    encrypted = cipher.encrypt(pad(password.encode(), AES.block_size))
    return b64encode(encrypted).decode()

def main():
    password = "secret"
    key = "mykey"
    encrypted = encrypt_password(password, key)
    print("Encrypted password:", encrypted)

if __name__ == "__main__":
    main()
