#include <stdio.h>
#include <stdlib.h>

int main()
{
    int size;
    int* arr;

    printf("Enter the size of the array: ");
    scanf("%d", &size);

    arr = (int*)malloc(size * sizeof(int))

    if (arr == NULL)
    {
        printf("Memory allocation failed.\n");
        return 1;s
    }

    printf("Memory allocated successfully.\n");


    free(arr); 

    return 0;
}