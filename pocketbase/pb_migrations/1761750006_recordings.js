/// <reference path="../pb_data/types.d.ts" />

// Recordings: samples users record themselves on the Record page instead of generating them.
// They have the model "recording" (RECORDING_MODEL in src/lib/tts.ts), no speaker record (the
// recording user's name is stored in speaker_name), no seed and no job. The transcript (text) is
// usually added after recording, so it may be empty, and owners can change the transcript and
// dialect of their recordings later; generated samples keep their settings as before.

const OWNER = "owner = @request.auth.id"
const FIXED = [
  "owner", "speaker", "speaker_name", "audio", "ref_text", "model", "checkpoint",
  "seed", "duration_s", "job_id", "sample_index",
]
const RECORDING = 'model = "recording"'

const OLD_UPDATE_RULE = [OWNER, ...[...FIXED.filter((f) => f !== "speaker_name"), "text", "language"].map((f) => `@request.body.${f}:isset = false`)].join(" && ")

migrate((app) => {
  const samples = app.findCollectionByNameOrId("samples")
  samples.fields.add(new TextField({ name: "speaker_name", max: 200 }))
  samples.fields.getByName("text").required = false
  samples.fields.getByName("job_id").required = false
  // recordings have no job; generated samples are still kept once per job and index
  samples.indexes = samples.indexes.filter((i) => !i.includes("idx_samples_job_sample"))
  samples.indexes.push("CREATE UNIQUE INDEX idx_samples_job_sample ON samples (job_id, sample_index) WHERE job_id != ''")
  samples.updateRule = [
    OWNER,
    ...FIXED.map((f) => `@request.body.${f}:isset = false`),
    `(${RECORDING} || (@request.body.text:isset = false && @request.body.language:isset = false))`,
  ].join(" && ")
  app.save(samples)
}, (app) => {
  const samples = app.findCollectionByNameOrId("samples")
  // recordings can't be represented without these fields
  for (const record of app.findRecordsByFilter("samples", RECORDING)) {
    app.delete(record)
  }
  samples.fields.removeByName("speaker_name")
  samples.fields.getByName("text").required = true
  samples.fields.getByName("job_id").required = true
  samples.indexes = samples.indexes.filter((i) => !i.includes("idx_samples_job_sample"))
  samples.indexes.push("CREATE UNIQUE INDEX idx_samples_job_sample ON samples (job_id, sample_index)")
  samples.updateRule = OLD_UPDATE_RULE
  app.save(samples)
})
