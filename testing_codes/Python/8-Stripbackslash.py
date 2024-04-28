def main():
    str_input = input("Enter a string: ")

    modified_str = []
    for char in str_input:
        if char != '\\':
            modified_str.append(char)

    result = ''.join(modified_str)

if __name__ == "__main__":
    main()
