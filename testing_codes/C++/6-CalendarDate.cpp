#include <iostream>
#include <vector>
#include <string>
#include <ctime>
#include <netinet/in.h>
#include <arpa/inet.h>

// Define a class to represent calendar dates
class CalendarDate {
public:
    CalendarDate(std::string date, std::string description) : date(date), description(description) {}

    std::string get_date() const {
        return date;
    }

    std::string get_description() const {
        return description;
    }

private:
    std::string date;
    std::string description;
};

// Define a class to handle the server logic
class CalendarServer {
public:
    CalendarServer() {}

    // Start the server
    void start_server() {
        int server_socket = socket(AF_INET, SOCK_STREAM, 0);
        if (server_socket == -1) {
            std::cerr << "Error: Failed to create socket\n";
            return;
        }

        struct sockaddr_in server_address;
        server_address.sin_family = AF_INET;
        server_address.sin_addr.s_addr = INADDR_ANY;
        server_address.sin_port = htons(1234);

        if (bind(server_socket, (struct sockaddr *)&server_address, sizeof(server_address)) < 0) {
            std::cerr << "Error: Bind failed\n";
            return;
        }

        listen(server_socket, 5);

        while (true) {
            int client_socket = accept(server_socket, NULL, NULL);
            if (client_socket < 0) {
                std::cerr << "Error: Accept failed\n";
                continue;
            }

            char buffer[1024] = {0};
            int valread = read(client_socket, buffer, 1024);

            if (valread <= 0) {
                std::cerr << "Error: Failed to read from client\n";
                close(client_socket);
                continue;
            }

            // Deserialize received data
            std::string serialized_data(buffer);
            CalendarDate calendar_date = deserialize(serialized_data);

            // Add calendar date to the list
            calendar_dates.push_back(calendar_date);

            close(client_socket);
        }
    }

    // Return the list of calendar dates
    std::vector     <CalendarDate> get_calendar_dates() const {
        return calendar_dates;
    }
};

int main() {
    CalendarServer server;
    server.start_server();
    return 0;
}


