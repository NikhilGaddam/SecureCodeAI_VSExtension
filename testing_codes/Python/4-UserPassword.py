import re

login = input("Input the login: ")
password = input("Input the password: ")

pattern = re.compile("(" + login + ")")
if pattern.search(password):
    print("The login cannot be included in the password.")
else:
    print("Password is valid.")
