import socket
import pickle
from datetime import datetime

class CalendarDate:
    def __init__(self, date, description):
        self.date = date
        self.description = description

class CalendarServer:
    def __init__(self):
        self.calendar_dates = []

    def start_server(self):
        server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_socket.bind(('localhost', 1234))
        server_socket.listen(5)

        while True:
            client_socket, addr = server_socket.accept()
            data = client_socket.recv(1024)
            calendar_date = pickle.loads(data)
            self.calendar_dates.append(calendar_date)
            client_socket.close()

    def get_calendar_dates(self):
        return self.calendar_dates

if __name__ == "__main__":
    server = CalendarServer()
    server.start_server()