import urllib.request
import json

req = urllib.request.Request("https://api.github.com/repos/steveberardi/starplot-gaia-dr3/releases")
req.add_header('User-Agent', 'Mozilla/5.0')
try:
    response = urllib.request.urlopen(req)
    releases = json.loads(response.read().decode('utf-8'))
    for r in releases:
        print(f"Release: {r['name']}")
        for a in r['assets']:
            print(f"  - {a['name']} ({a['size']/1e9:.2f} GB)")
except Exception as e:
    print(e)
