import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.DocumentBuilder;
import org.w3c.dom.Document;
import java.io.InputStream;

public class SafeXMLParser {
    public static void main(String[] args) {
        try {
            DocumentBuilderFactory dbFactory = DocumentBuilderFactory.newInstance();
            dbFactory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            dbFactory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            dbFactory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            dbFactory.setExpandEntityReferences(false);

            DocumentBuilder dBuilder = dbFactory.newDocumentBuilder();

            InputStream xmlInput = SafeXMLParser.class.getResourceAsStream("userInput.xml"); // Replace with actual input stream
            Document doc = dBuilder.parse(xmlInput);

            // Process the XML as needed

            xmlInput.close();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
