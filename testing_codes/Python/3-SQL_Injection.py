import sqlite3

def main():
    conn = sqlite3.connect('test.db')
    c = conn.cursor()

    print("Opened database successfully")

    name = input("Enter name: ")
    password = input("Enter password: ")

    sql = "INSERT INTO Users (name, password) VALUES ('{}', '{}')".format(name, password)
    try:
        c.execute(sql)
        conn.commit()
        print("Records created successfully")
    except sqlite3.Error as e:
        print("SQL error:", e)
    finally:
        conn.close()

if __name__ == "__main__":
    main()
