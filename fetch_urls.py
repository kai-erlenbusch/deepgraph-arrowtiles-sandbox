import urllib.request
import re

html = urllib.request.urlopen('https://cdn.gea.esac.esa.int/Gaia/gdr3/gaia_source/').read().decode('utf-8')
matches = re.findall(r'href="(.*?\.csv\.gz)"', html)
print(matches[:5])
print(f"Total files: {len(matches)}")
