from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
import base64

def pad(s):
    return s + (AES.block_size - len(s) % AES.block_size) * chr(AES.block_size - len(s) % AES.block_size)

def encrypt(plain_text, password, salt):
    iv = get_random_bytes(16)
    cipher = AES.new(password, AES.MODE_CBC, iv)
    encrypted_text = cipher.encrypt(pad(plain_text))
    return salt + iv + encrypted_text

def base64_encode(data):
    return base64.b64encode(data).decode('utf-8')

plain_text = "This is a string to be encrypted"
password = b"MySecretPassword"
salt = b"MySalt"

encrypted_text = encrypt(plain_text, password, salt)
encoded_text = base64_encode(encrypted_text)

print("Encrypted text:", encoded_text)
