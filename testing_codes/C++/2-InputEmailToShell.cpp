#include <iostream>
#include <cstdlib>
#include <string>

int main() {
    std::string email;
    std::cout << "Enter your email address: ";
    std::getline(std::cin, email);

    if (email.find('@') == std::string::npos) {
        std::cout << "Invalid Email" << std::endl;
        return 1;
    }

    std::string command = "program.py " + email;
    system(command.c_str());

    return 0;
}
