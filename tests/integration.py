#!/usr/bin/env python3
"""Exercise the Rust API against the selected running environment."""
import base64
import concurrent.futures
import json
import hashlib
import sys
import urllib.error
import urllib.request
import uuid

base = sys.argv[1].rstrip('/')
def call(path, method='GET', value=None, headers=None):
    data = None if value is None else json.dumps(value).encode()
    request = urllib.request.Request(base+path,data=data,method=method,headers={'Content-Type':'application/json',**(headers or {})})
    try:
        response = urllib.request.urlopen(request,timeout=30)
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    body = response.read()
    return response.status, json.loads(body) if 'application/json' in response.headers.get('Content-Type','') else body

assert call('/health')[1]['status'] == 'ok'
binary = bytes(range(256))
request = urllib.request.Request(base+'/api/digest', data=binary, method='POST', headers={'Content-Type':'application/octet-stream'})
with urllib.request.urlopen(request) as response:
    assert json.load(response)['sha256'] == hashlib.sha256(binary).hexdigest()
assert b'<html' in call('/')[1]
id = 'acceptance-'+uuid.uuid4().hex
book = {'id':id,'title':'Acceptance book','outline':[],'tags':[]}
status, saved = call('/api/books/'+id,'PUT',book)
assert status == 200 and saved['_revision'] == 1
assert call('/api/books/'+id)[1]['title'] == book['title']
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(lambda title: call('/api/books/'+id,'PUT',{**saved,'title':title})[0],['First editor','Second editor']))
assert sorted(results) == [200,409], results
assert call('/api/books/'+id,'DELETE',headers={'If-Match':'1'})[0] == 409
assert call('/api/books/'+id,'DELETE',headers={'If-Match':'2'})[0] == 204
translation = {**book,'translations':[{'pageNumber':1,'language':'ta','complexity':'simplified','paragraphs':['தமிழ் உரை'],'model':'test'}],'pageSnapshots':[],'translationMemory':[],'translationJobs':[]}
status, saved = call('/api/translations/'+id,'PUT',translation)
assert status == 200
pdf = b'%PDF-1.4\nAcceptance source\n'
asset_id = id+'-pdf'
assert call('/api/assets/'+asset_id,'PUT',{'bookId':id,'fileName':'source.pdf','mimeType':'application/pdf','base64':base64.b64encode(pdf).decode()})[0] == 200
assert call('/api/assets/'+asset_id)[1] == pdf
assert call('/api/translations/'+id+'/position','PATCH',{'pageNumber':2})[0] == 204
assert call('/api/translations/'+id)[1]['translations'][0]['paragraphs'] == ['தமிழ் உரை']
request = urllib.request.Request(base+'/api/exports/'+id+'/book.html',data=b'<!doctype html><html><body>Acceptance translation</body></html>',method='PUT',headers={'Content-Type':'text/html'})
assert urllib.request.urlopen(request).status == 200
assert b'Acceptance translation' in call('/api/exports/'+id+'/book.html')[1]
assert len(call('/api/exports/'+id)[1]['files']) == 1
assert call('/api/translations/'+id,'DELETE',headers={'If-Match':str(saved['_revision'])})[0] == 204
assert call('/api/assets/'+asset_id)[0] == 404
print('PASS health, frontend, authoring CRUD, concurrent edits, translation variants, PDF assets, reading position, HTML exports and cleanup')
