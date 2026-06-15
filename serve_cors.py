import http.server
import socketserver

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Range')
        self.send_header('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Encoding, Content-Length, Content-Range')
        http.server.SimpleHTTPRequestHandler.end_headers(self)
        
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    port = 8080
    import functools
    handler = functools.partial(CORSRequestHandler, directory='D:/exploratory/duckdb-extension')
    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"Serving HTTP on port {port} with CORS enabled...")
        httpd.serve_forever()
