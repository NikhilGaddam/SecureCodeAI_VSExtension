#include <iostream>
#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/bio.h>
#include <openssl/buffer.h>
#include <cstring>
#include <string>
#include <iomanip>

using namespace std;

string base64_encode(const unsigned char* input, int length) {
    BIO *bio, *b64;
    BUF_MEM *bufferPtr;
    b64 = BIO_new(BIO_f_base64());
    BIO_set_flags(b64, BIO_FLAGS_BASE64_NO_NL);
    bio = BIO_new(BIO_s_mem());
    bio = BIO_push(b64, bio);
    BIO_write(bio, input, length);
    BIO_flush(bio);
    BIO_get_mem_ptr(bio, &bufferPtr);
    BIO_set_close(bio, BIO_NOCLOSE);
    string result(bufferPtr->data, bufferPtr->length);
    BIO_free_all(bio);
    return result;
}

int main() {
    OpenSSL_add_all_algorithms();
    EVP_add_cipher(EVP_aes_256_cbc());

    string plainText = "This is a string to be encrypted";
    string password = "MySecretPassword";
    unsigned char salt[] = "MySalt";
    unsigned char ivBytes[16];
    RAND_bytes(ivBytes, sizeof(ivBytes));

    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    EVP_EncryptInit_ex(ctx, EVP_aes_256_cbc(), NULL, (const unsigned char*)password.c_str(), ivBytes);

    int cipherTextLen = plainText.length() + EVP_CIPHER_CTX_block_size(ctx);
    unsigned char *cipherText = (unsigned char *)malloc(cipherTextLen);
    int len;
    EVP_EncryptUpdate(ctx, cipherText, &len, (const unsigned char*)plainText.c_str(), plainText.length());
    int cipherTextLenFinal;
    EVP_EncryptFinal_ex(ctx, cipherText + len, &cipherTextLenFinal);
    cipherTextLen += cipherTextLenFinal;

    unsigned char *combined = (unsigned char *)malloc(strlen((char*)salt) + sizeof(ivBytes) + cipherTextLen);
    memcpy(combined, salt, strlen((char*)salt));
    memcpy(combined + strlen((char*)salt), ivBytes, sizeof(ivBytes));
    memcpy(combined + strlen((char*)salt) + sizeof(ivBytes), cipherText, cipherTextLen);

    string encryptedText = base64_encode(combined, strlen((char*)salt) + sizeof(ivBytes) + cipherTextLen);

    cout << "Encrypted text: " << encryptedText << endl;

    EVP_CIPHER_CTX_free(ctx);
    free(cipherText);
    free(combined);

    return 0;
}
