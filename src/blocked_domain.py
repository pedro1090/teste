//lista de coisas dentro de scripts que apontam anuncios
file_in = open("dominain_blockaraw.txt", "r")
file_out = open("blocked_domains.js ", "w")

line = file_in.readline()
file_out.write("var blocked_ids = [\n")

first = True
while(line):
    if("127.0.0.1 " in line):
        if not first:
             file_out.write(",\n")
        first = False
        line = (line.lstrip("127.0.0.1 ")).rstrip("]\n")
        parsed_line = "*://*." + line + "/*"
        file_out.write("\"" + parsed_line + "\"")
    line = file_in.readline()
file_out.write("]")
file_out.close()
file_in.close()
