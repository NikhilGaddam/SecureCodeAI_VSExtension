import java.sql.*;

public class Main {
    public static void main(String[] args) {
        Connection conn = null;
        Statement stmt = null;
        try {
            Class.forName("org.sqlite.JDBC");
            conn = DriverManager.getConnection("jdbc:sqlite:test.db");
            System.out.println("Opened database successfully");

            String name = "";
            String password = "";

            System.out.print("Enter name: ");
            name = System.console().readLine();
            System.out.print("Enter password: ");
            password = System.console().readLine();

            stmt = conn.createStatement();
            String sql = "INSERT INTO Users (name, password) VALUES ('" + name + "', '" + password + "')";
            stmt.executeUpdate(sql);

            System.out.println("Records created successfully");
        } catch (Exception e) {
            System.err.println(e.getClass().getName() + ": " + e.getMessage());
            System.exit(0);
        } finally {
            try {
                if (stmt != null) stmt.close();
                if (conn != null) conn.close();
            } catch (SQLException e) {
                e.printStackTrace();
            }
        }
        System.out.println("Operation done successfully");
    }
}
