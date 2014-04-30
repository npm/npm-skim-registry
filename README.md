# npm-skim-registry

[Mcouch](http://npm.im/mcouch) for npm registries.  The opposite of
[npm-fullfat-registry](http://npm.im/npm-fullfat-registry).

[![wercker status](https://app.wercker.com/status/185fe5071b01008479f47c654f86cdbc/m/ "wercker status")](https://app.wercker.com/project/bykey/185fe5071b01008479f47c654f86cdbc)

This moves attachments to the target in manta, but then *also* deletes
them out of the couchdb.  It avoids then deleting them out of manta,
by specifying a `{skip: true}` value for each tarball associated with
a published version.

This results in deleting attachments that don't belong (except for
`favicon.ico` on the `npm` doc, which is a special magical snowflake),
but keeping attachments in Manta if they are needed for a published
version, even as they are removed from couchdb.

You probably don't need this.  It's super niche.  More likely, if
you're even reading this, you want either [mcouch](http://npm.im/mcouch)
or [npm-fullfat-registry](http://npm.im/npm-fullfat-registry).

## USAGE

```javascript
Skim({
  client: myMantaClient,
  db: myCouchDBUrl,
  path: pathInMantaWhereStuffGoes,
  seqFile: '.sequence',
  inactivity_ms: 60*60*1000,
  delete: true
}).on('put', function(doc) {
  console.log('PUT %s', doc._id);
}).on('rm', function(doc) {
  console.log('RM %s', doc._id);
}).on('send', function(doc, file) {
  console.log('-> sent %s/%s', doc._id, file.name);
}).on('delete', function(doc, remote) {
  console.log('-> deleted %s/%s', doc._id, remote);
});
```

Or on the cli:

```
npm-skim-registry - Skim the fat out of your registry couchdb
Usage: npm-skim-registry [args] COUCHDB MANTAPATH

    COUCHDB                             Full url to your couch, like
                                        http://localhost:5984/database
    MANTAPATH                           Remote path in Manta, like
                                        ~~/stor/database
    -Q FILE, --seq-file=FILE            File to store the sequence in
    -q NUMBER, --seq=NUMBER             Sequence ID to start at
    --inactivity-ms=MS                  Max ms to wait before assuming
                                        disconnection.
    -d, --delete                        Delete removed attachments and docs from
                                        manta
    -s URL, --skim=URL                  Target to write attachment free docs.
                                        Defaults to put back into COUCHDB arg.
    -a ACCOUNT, --account=ACCOUNT       Manta Account (login name)
    -h, --help                          Print this help and exit
    -i, --insecure                      Do not validate SSL certificate
    -k FINGERPRINT, --keyId=FINGERPRINT SSH key fingerprint
    -u URL, --url=URL                   Manta URL
    -v, --verbose                       verbose mode
```
