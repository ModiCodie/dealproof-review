"""Builds the SYNTHETIC search fixtures used by the generic-search tests.

Everything here is invented: retailers are fictional (.example domains), prices
are made up, and nothing was fetched from PricesAPI. Titles imitate the style of
real listings so the matcher is exercised realistically. Run: python3 build.py
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
SELLERS = {
  'north': ('NorthStar Electronics', 'https://www.northstar-electronics.example'),
  'blue': ('Bluebird Tech', 'https://www.bluebirdtech.example'),
  'harbor': ('Harbor Outlet', 'https://www.harboroutlet.example'),
  'summit': ('Summit Gadgets', 'https://www.summitgadgets.example'),
  'lumen': ('Lumen Direct', 'https://www.lumendirect.example'),
  'orchard': ('Orchard Digital', 'https://www.orcharddigital.example'),
  'pine': ('Pinecone Supply', 'https://www.pineconesupply.example'),
  'delta': ('Delta Home & Tech', 'https://www.deltahometech.example'),
  'kite': ('Kite Mart', 'https://www.kitemart.example'),
  'ember': ('Ember Shop', 'https://www.embershop.example'),
}
def offer(s, price, title, stock='In stock', delivery='Free delivery', slug=None):
    name, base = SELLERS[s]
    path = (slug or title.lower().replace(' ', '-').replace('/', '-'))[:60]
    return {'seller': name, 'sellerUrl': base + '/', 'price': price, 'currency': 'USD', 'title': title,
            'listingUrl': f'{base}/p/{path}', 'stockText': stock,
            'availability': 'in_stock' if stock == 'In stock' else 'out_of_stock', 'deliveryInfo': delivery,
            'condition': 'unknown', 'observedAt': None}
def cand(pid, title, offers, label=None):
    return {'pid': pid, 'productRef': {'id': str(pid), 'idType': 'pricesapi', 'market': 'us'}, 'catalogId': None, 'clusterId': None,
            'title': title, 'headlinePrice': None, 'headlineCurrency': None, 'conditionLabel': label, 'offerCount': len(offers), 'offers': offers}
def write(name, query, cands):
    doc = {'_note': 'SYNTHETIC: invented retailers, prices and listings for tests. Not PricesAPI data.', 'query': query, 'market': 'us',
           'candidates': cands,
           'source': {'scrapedAt': '2026-11-21T15:00:00.000Z', 'upstreamCacheSource': 'miss', 'upstreamCacheAgeSeconds': None, 'servedStale': None, 'degraded': None, 'upstreamLatencyMs': 21000}}
    json.dump(doc, open(os.path.join(HERE, name), 'w'), indent=1)

# ---- Consumer audio: AirPods Pro 2 (generation, USB-C, accessories, multipack, used, special edition)
ap2 = 'Apple AirPods Pro 2nd Generation Wireless Earbuds'
write('airpods.json', 'Apple AirPods Pro 2', [
  cand(9001, 'Apple AirPods Pro (2nd Generation) Wireless Earbuds with MagSafe Charging Case', [
    offer('north', 189.99, ap2 + ' with MagSafe Case (USB-C)'),
    offer('blue', 194.5, 'Apple AirPods Pro 2 Wireless Earbuds, MQD83AM/A'),
    offer('harbor', 199.0, 'Apple AirPods Pro (2nd generation) with MagSafe Charging Case'),
    offer('summit', 204.99, 'AirPods Pro 2nd Gen Apple Bluetooth Earbuds'),
    offer('lumen', 209.0, 'Apple AirPods Pro 2 USB-C Active Noise Cancelling Earbuds'),
    offer('orchard', 214.95, 'Apple AirPods Pro 2nd Generation Earbuds - New', delivery=None),
    offer('pine', 219.0, 'Apple AirPods Pro 2 Wireless Earbuds', stock='Out of stock'),
    offer('delta', 229.99, 'Apple AirPods Pro (2nd Generation)'),
    offer('north', 189.99, ap2 + ' with MagSafe Case (USB-C)'),            # exact duplicate listing
    offer('kite', 59.0, 'Apple AirPods Pro 2 Wireless Earbuds (2nd Generation)'),   # far below the others
    offer('ember', 129.0, 'Apple AirPods Pro 1st Generation Wireless Earbuds'),
    offer('harbor', 124.0, 'Apple AirPods Pro (1st Gen) with Wireless Charging Case'),
    offer('blue', 449.0, 'Apple AirPods Max Wireless Over-Ear Headphones'),
    offer('summit', 8.99, 'Silicone Case Cover for Apple AirPods Pro 2 Protective Skin'),
    offer('lumen', 12.5, 'Replacement Ear Tips for Apple AirPods Pro 2nd Generation'),
    offer('orchard', 369.0, 'Apple AirPods Pro 2 Wireless Earbuds 2-Pack'),
    offer('pine', 249.0, 'Apple AirPods Pro 2 Limited Edition Wireless Earbuds'),
    offer('delta', 149.0, 'Apple AirPods Pro 2nd Generation Earbuds - Used, Good condition'),
    offer('kite', 179.0, 'Apple Wireless Earbuds with Charging Case'),
  ]),
  cand(9002, 'Apple AirPods Pro (1st Generation) with Wireless Charging Case', [
    offer('ember', 129.0, 'Apple AirPods Pro 1st Generation Wireless Earbuds'),
    offer('harbor', 134.0, 'Apple AirPods Pro (1st Gen) Wireless Charging Case MWP22AM/A'),
    offer('north', 139.0, 'Apple AirPods Pro 1st Generation'),
  ]),
  cand(9003, 'Apple AirPods (3rd Generation) with Lightning Charging Case', [
    offer('blue', 139.0, 'Apple AirPods 3rd Generation with Lightning Charging Case'),
    offer('lumen', 144.0, 'Apple AirPods (3rd Gen) Earbuds'),
  ]),
])

# ---- Computer hardware: WD Black SN850X (capacity, heatsink, different model families)
sn = 'WD_BLACK SN850X NVMe SSD'
write('ssd.json', 'WD Black SN850X 2TB', [
  cand(9101, 'WD_BLACK 2TB SN850X NVMe Internal Gaming SSD Solid State Drive', [
    offer('north', 149.99, sn + ' 2TB'),
    offer('blue', 154.0, 'Western Digital WD Black SN850X 2TB PCIe Gen4 M.2 2280 Internal SSD'),
    offer('harbor', 159.5, 'WD_BLACK SN850X 2TB NVMe M.2 SSD WDS200T2X0E'),
    offer('summit', 162.0, 'WD Black SN850X 2 TB Internal Gaming SSD'),
    offer('lumen', 165.99, 'WD_BLACK SN850X 2TB Gaming SSD, Gen4 PCIe'),
    offer('orchard', 171.0, 'Western Digital WD_BLACK 2TB SN850X NVMe SSD'),
    offer('pine', 178.0, 'WD_BLACK SN850X 2TB SSD with Heatsink'),
    offer('delta', 181.0, 'WD_BLACK SN850X 2TB NVMe SSD with Heatsink'),
    offer('kite', 89.0, 'WD_BLACK SN850X 2TB NVMe M.2 SSD'),
    offer('north', 89.99, 'WD_BLACK SN850X 1TB NVMe SSD'),
    offer('blue', 94.0, 'Western Digital WD Black SN850X 1TB Internal SSD'),
    offer('harbor', 99.5, 'WD_BLACK SN850X 1TB M.2 SSD'),
    offer('summit', 299.0, 'WD_BLACK SN850X 4TB NVMe SSD'),
    offer('lumen', 129.0, 'WD_BLACK SN770 2TB NVMe SSD'),
    offer('orchard', 119.0, 'WD_BLACK SN850 2TB NVMe SSD'),
    offer('pine', 15.0, 'M.2 Heatsink Cooler for WD_BLACK SN850X SSD'),
    offer('ember', 139.0, 'WD_BLACK SN850X 2TB NVMe SSD - Refurbished'),
    offer('delta', 160.0, 'WD_BLACK SN850X NVMe SSD'),
    offer('kite', 145.0, 'WD_BLACK SN850X SSD 1TB / 2TB / 4TB'),
  ]),
  cand(9102, 'WD_BLACK 1TB SN850X NVMe Internal Gaming SSD', [
    offer('north', 89.99, sn + ' 1TB'),
    offer('blue', 94.0, 'Western Digital WD Black SN850X 1TB Internal SSD'),
  ]),
])

# ---- Home electronics: Dyson V15 Detect (trim levels, other models, parts, bundles, missing model)
dy = 'Dyson V15 Detect Cordless Vacuum Cleaner'
write('dyson.json', 'Dyson V15 Detect', [
  cand(9201, 'Dyson V15 Detect Cordless Vacuum Cleaner', [
    offer('north', 649.99, dy + ' Yellow/Nickel'),
    offer('blue', 659.0, dy),
    offer('harbor', 664.95, 'Dyson V15 Detect Cordless Stick Vacuum'),
    offer('summit', 669.0, 'Dyson V15 Detect Vacuum Cleaner - Yellow'),
    offer('lumen', 674.0, 'Dyson V15 Detect Cordless Vacuum'),
    offer('orchard', 679.99, 'Dyson V15 Detect Cordless Vacuum Cleaner, Nickel'),
    offer('pine', 689.0, 'Dyson V15 Detect Absolute Cordless Vacuum Cleaner'),
    offer('delta', 699.0, 'Dyson V15 Detect + Extra Attachments Bundle'),
    offer('kite', 559.0, 'Dyson V12 Detect Slim Cordless Vacuum Cleaner'),
    offer('ember', 479.0, 'Dyson V11 Cordless Vacuum Cleaner'),
    offer('north', 39.0, 'Replacement Battery for Dyson V15 Detect Cordless Vacuum'),
    offer('blue', 24.0, 'Washable Filter for Dyson V15 V12 V11 Cordless Vacuums'),
    offer('harbor', 399.0, 'Dyson Cordless Vacuum Cleaner'),
    offer('summit', 619.0, 'Dyson V15 Detect Cordless Vacuum - Refurbished'),
    offer('lumen', 329.0, 'Dyson V15 Detect Vacuum Compatible with V12 V15'),
  ]),
])

# ---- No results / ambiguous / underspecified
write('empty.json', 'Zorblax Quantum Teapot 9000', [])
write('vague.json', 'Dyson cordless vacuum', [
  cand(9301, 'Dyson V15 Detect Cordless Vacuum Cleaner', [offer('north', 649.99, dy), offer('blue', 659.0, dy)]),
  cand(9302, 'Dyson V8 Cordless Vacuum Cleaner', [offer('harbor', 299.0, 'Dyson V8 Cordless Vacuum Cleaner'), offer('summit', 309.0, 'Dyson V8 Absolute Cordless Vacuum')]),
  cand(9303, 'Dyson Outsize Cordless Vacuum Cleaner', [offer('lumen', 549.0, 'Dyson Outsize Cordless Vacuum')]),
])
print('built')
