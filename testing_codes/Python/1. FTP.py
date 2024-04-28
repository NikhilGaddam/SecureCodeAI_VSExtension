import socket
import os
import threading

class FileServer:
    def __init__(self, port, file_directory):
        self.port = port
        self.file_directory = file_directory
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.bind(('localhost', port))
        self.server_socket.listen(5)

    def start(self):
        while True:
            client_socket, _ = self.server_socket.accept()
            threading.Thread(target=self.handle_client, args=(client_socket,)).start()

    def handle_client(self, client_socket):
        with client_socket:
            data = client_socket.recv(1024).decode().strip()
            if data:
                filename = os.path.join(self.file_directory, data)
                if os.path.exists(filename) and os.path.isfile(filename):
                    with open(filename, 'rb') as file:
                        data = file.read(1024)
                        while data:
                            client_socket.send(data)
                            data = file.read(1024)
                else:
                    client_socket.sendall(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")


def main():
    import sys
    if len(sys.argv) != 3:
        print("Usage: python file_server.py <port> <file_directory>")
        return

    port = int(sys.argv[1])
    file_directory = sys.argv[2]

    server = FileServer(port, file_directory)
    server.start()


if __name__ == "__main__":
    main()
