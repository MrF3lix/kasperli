/// <reference path="../pb_data/types.d.ts" />

// Datasets: named collections of saved samples, shared with other users.
// The creator (owner) and the users added to a dataset can all view and edit it; only the owner
// can delete it and nobody can change the owner. Each sample in a dataset is its own
// dataset_samples record, so access rules can check every added sample: users can only add
// their own saved samples. Samples (and the speakers they were generated from) in a dataset are
// visible to everyone with access to it, so users now see each other's names and emails to share.

const SVC = '@request.auth.collectionName = "services"'
const USER = '@request.auth.collectionName = "users"'

// access to the dataset at this path ("" for the datasets collection itself)
function datasetAccess(path) {
  const p = path ? `${path}.` : ""
  // (a multi relation only matches with .id: "users ?= ..." finds nothing)
  return `${p}owner ?= @request.auth.id || ${p}users.id ?= @request.auth.id`
}

const OLD = {
  usersList: `id = @request.auth.id || ${SVC}`,
  ownerOrService: `owner = @request.auth.id || ${SVC}`,
}

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const samples = app.findCollectionByNameOrId("samples")
  const speakers = app.findCollectionByNameOrId("speakers")

  const datasets = new Collection({
    type: "base",
    name: "datasets",
    listRule: datasetAccess(""),
    viewRule: datasetAccess(""),
    createRule: `${USER} && owner = @request.auth.id`,
    updateRule: `(${datasetAccess("")}) && @request.body.owner:isset = false`,
    deleteRule: "owner = @request.auth.id",
    fields: [
      // deleting the owner's account deletes their datasets
      { type: "relation", name: "owner", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "name", required: true, max: 200 },
      // other users with access
      { type: "relation", name: "users", collectionId: users.id, maxSelect: 999 },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_datasets_owner ON datasets (owner)",
    ],
  })
  app.save(datasets)

  const datasetSamples = new Collection({
    type: "base",
    name: "dataset_samples",
    listRule: datasetAccess("dataset"),
    viewRule: datasetAccess("dataset"),
    // only one's own samples, into datasets one has access to
    createRule: `${USER} && sample.owner = @request.auth.id && (${datasetAccess("dataset")})`,
    updateRule: null,
    deleteRule: datasetAccess("dataset"),
    fields: [
      { type: "relation", name: "dataset", collectionId: datasets.id, required: true, maxSelect: 1, cascadeDelete: true },
      // deleting a saved sample removes it from its datasets
      { type: "relation", name: "sample", collectionId: samples.id, required: true, maxSelect: 1, cascadeDelete: true },
      { type: "autodate", name: "created", onCreate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_dataset_samples_dataset_sample ON dataset_samples (dataset, sample)",
      "CREATE INDEX idx_dataset_samples_sample ON dataset_samples (sample)",
    ],
  })
  app.save(datasetSamples)

  // samples in a dataset, and their speakers, are visible to everyone with access to it
  const sampleRule = `owner = @request.auth.id || ${datasetAccess("dataset_samples_via_sample.dataset")} || ${SVC}`
  samples.listRule = sampleRule
  samples.viewRule = sampleRule
  app.save(samples)

  const speakerRule = `owner = @request.auth.id || ${datasetAccess("samples_via_speaker.dataset_samples_via_sample.dataset")} || ${SVC}`
  speakers.listRule = speakerRule
  speakers.viewRule = speakerRule
  app.save(speakers)

  // users pick each other by name and email when sharing a dataset
  users.listRule = `${USER} || ${SVC}`
  users.viewRule = `${USER} || ${SVC}`
  app.save(users)
  app.db().newQuery("UPDATE users SET emailVisibility = TRUE").execute()

  // a dataset and its samples are created in one transaction
  const settings = app.settings()
  settings.batch.enabled = true
  settings.batch.maxRequests = 1001
  settings.batch.timeout = 60
  app.save(settings)
}, (app) => {
  app.delete(app.findCollectionByNameOrId("dataset_samples"))
  app.delete(app.findCollectionByNameOrId("datasets"))

  for (const name of ["samples", "speakers"]) {
    const collection = app.findCollectionByNameOrId(name)
    collection.listRule = OLD.ownerOrService
    collection.viewRule = OLD.ownerOrService
    app.save(collection)
  }

  const users = app.findCollectionByNameOrId("users")
  users.listRule = OLD.usersList
  users.viewRule = OLD.usersList
  app.save(users)
  app.db().newQuery("UPDATE users SET emailVisibility = FALSE").execute()

  const settings = app.settings()
  settings.batch.enabled = false
  app.save(settings)
})
