import zipfile
import sys

def main():
    if len(sys.argv) < 2:
        print("Please specify a .zip file as an argument.", file=sys.stderr)
        return

    try:
        with zipfile.ZipFile(sys.argv[1], 'r') as z:
            for filename in z.namelist():
                try:
                    with z.open(filename) as file:
                        data = file.read()
                        # Perform some manipulation on the file data
                        # ...

                except Exception as e:
                    print(f"Failed to extract file: {filename}", file=sys.stderr)
    except Exception as e:
        print("Failed to open the .zip file.", file=sys.stderr)

if __name__ == '__main__':
    main()
