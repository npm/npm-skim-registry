// load in mcouch
// change up the appropriate logic
// - set a {skip:true} on any tgz attachment for any version, if missing
// - remove any attachments that are not for published versions, except
//   for "favicon.ico" on the "npm" doc
// - if opts.vacuum is set, then remove the attachments and PUT back

var MantaCouch = require('mcouch')
var util = require('util')
var hh = require('http-https')
var parse = require('parse-json-response')
var url = require('url')

module.exports = Skim

util.inherits(Skim, MantaCouch)

function Skim(opts) {
  if (!(this instanceof Skim))
    return new Skim(opts)

  MantaCouch.call(this, opts)

  this.on('put', this.onput)
}

Skim.prototype.onput = function(doc) {
  // remove any attachments that don't belong, and
  // put any previously-vacuumed tgz's with a {skip:true}
  var att = doc._attachments || {}
  var versions = Object.keys(doc.versions || {})

  Object.keys(att).forEach(function(f) {
    if (doc.name === 'npm' && f === 'favicon.ico')
      return

    else if (f.indexOf(doc.name + '-') !== 0 || !f.match(/\.tgz$/))
      delete att[f]

    else {
      f = f.substr(doc.name + 1).replace(/\.tgz$/, '')
      if (!versions[f])
        delete att[f]
    }
  })

  versions.forEach(function (ver) {
    var f = doc.name + '-' + ver + '.tgz'
    if (!att[f])
      att[f] = { skip: true }
  })
}

Skim.prototype.onCuttleComplete = function(doc, results) {
  // the only attachment allowed is favicon.ico on npm record
  var k = Object.keys(doc._attachments || {})
  if (doc.name === 'npm')
    k = k.filter(function (key) { return key !== 'favicon.ico' })

  if (!k.length) {
    // no disallowed attachments, just leave as-is
    return MantaCouch.prototype.onCuttleComplete.call(this, doc, results)
  }

  if (doc._attachments) {
    if (doc.name === 'npm' && doc._attachments['favicon.ico'])
      doc._attachments = {
        'favicon.ico': doc._attachments['favicon.ico']
      }
    else
      delete doc._attachments
  }

  var p = url.parse(this.db + '/' + doc.name)
  delete doc._json
  var body = new Buffer(JSON.stringify(doc), 'utf8')
  p.method = 'PUT'
  p.headers = {
    'content-length': body.length,
    'content-type': 'application/json',
    connection: 'close'
  }

  // put the attachment-free document back to the database url
  hh.request(p, parse(function(er, data, res) {
    if (er)
      this.emit('error', er)
    else
      MantaCouch.prototype.onCuttleComplete.call(this, doc, results)
  }.bind(this))).end(body)
}
