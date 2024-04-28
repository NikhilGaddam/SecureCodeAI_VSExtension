#include <iostream>
#include <xercesc/parsers/XercesDOMParser.hpp>
#include <xercesc/util/XMLString.hpp>

int main() {
    try {
        xercesc::XMLPlatformUtils::Initialize();
        xercesc::XercesDOMParser* parser = new xercesc::XercesDOMParser();
        parser->setDoNamespaces(true);
        parser->setDoSchema(true);
        parser->setLoadExternalDTD(false);
        parser->setSkipDTDValidation(true);

        parser->parse("userInput.xml"); // Replace with the actual XML input path

        // Process the XML as needed

        delete parser;
        xercesc::XMLPlatformUtils::Terminate();
    } catch (const xercesc::XMLException& e) {
        char* message = xercesc::XMLString::transcode(e.getMessage());
        std::cout << "XMLException: " << message << std::endl;
        xercesc::XMLString::release(&message);
        return 1;
    }

    return 0;
}
