import http.server
import os
import sys

port = 8080
directory = 'dist'

class SPALocalHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def do_GET(self):
        # Resolve the requested file path
        resolved_path = self.translate_path(self.path)
        # If the file or directory does not exist, serve the 404.html fallback
        if not os.path.exists(resolved_path):
            self.path = '/404.html'
        return super().do_GET()

if __name__ == '__main__':
    os.chdir('/Users/k.rieke/Documents/antigravity/criteo-dynamic-test-shop')
    server = http.server.HTTPServer(('127.0.0.1', port), SPALocalHandler)
    print(f"Serving local test shop on http://127.0.0.1:{port} (fallback to /404.html enabled)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
        sys.exit(0)
