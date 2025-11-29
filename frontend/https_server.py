#!/usr/bin/env python3
import http.server
import ssl

server_address = ('0.0.0.0', 5500)
httpd = http.server.HTTPServer(server_address, http.server.SimpleHTTPRequestHandler)

# Wrap with SSL
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('cert.pem', 'key.pem')
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)

print(f"Serving HTTPS on https://0.0.0.0:5500")
print(f"Access from other devices: https://10.7.48.13:5500")
httpd.serve_forever()

