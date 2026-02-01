library(dplyr)
library(purrr)
library(janitor)
library(jsonlite)

rome_combine <- function(datasets, only_annotated=FALSE, use_names = c()) {
  #' Combine ROME-annotated datasets
  #'
  #' This function takes a list of datasets and returnes one unified dataset
  #' with harmonized names.
  #'
  #' @param datasets a list of datasets with dataset_id's as keys als lists(medadata, data) as values
  #' @param only_annotated return only annotated columns
  #' @param use_names a vector of system names whose codes should preferably be used as names
  #'
  #' Example:
  #' Assuming you have files data1.csv and metadata1.csv from study1, and a recapAPI connection rcon2 for
  #' study2, want to keep only the annotated fields and preferably use names from the "gecco" dataset,
  #' you can generate a combined dataset by calling
  #' rome_combine(list(study1=list(data=read.csv("data1.csv"), metadata=read.csv("metadata1.csv")),
  #'                   study2=list(data=exportRecords(rcon2), metadata=exportMetaData(rcon2)),
  #'              only_annotated=TRUE, use_names=c("gecco"))
  
  extract_ontologies <- function(metadata) {
    ## We rely on field_name being either field_name (API) or "Variable / Field name" (Data Dictionary CSV)
    ## as well as field_annotation + "Field Annotation"
    fields <- metadata |> clean_names() |> rename(any_of(c("field_name" = "variable_field_name"))) |>
      mutate(ontology_txt = gsub("@ONTOLOGY='([^']+)'", "\\1",  field_annotation)) |>
      filter(!is.na(ontology_txt)) |> select(field_name, ontology_txt)
    purrr::map2(fields$field_name, fields$ontology_txt, \(field_name, ontology_txt) 
                tryCatch({fromJSON(ontology_txt)$dataElement$coding}, error = function(e) {data.frame()}) |>
                  mutate(field_name=field_name)) |>
      bind_rows()
  }
  
  all_ontologies <- lapply(seq_along(datasets), \(i)
                           extract_ontologies(datasets[[i]]$metadata) |>
                             mutate(dataset = names(datasets)[i])) |>
    bind_rows() |>
    group_by(system, code) |>
    mutate(new_name = if_else(system %in% use_names, code, first(field_name))) |>
    ungroup() %>%
    distinct(dataset, field_name, .keep_all=T)
  
  ## all_ontologies is now a data frame with columns 
  ## dataset field_name system code display new_name
  ## of course, there can be multipe rows for the same field, it it's annotated using different systems
  
  lapply(seq_along(datasets), function(i) {
    df <- datasets[[i]]$data
    result <- df |> select(record_id=1, starts_with("redcap_"))
    rest <- df |> select(-1, -starts_with("redcap_"))
    new_names <- data.frame(dataset = names(datasets)[i],
                            field_name = names(rest)) %>%
      left_join(all_ontologies, by=c("dataset", "field_name"))
    if (only_annotated) {
      new_names <- new_names |> filter(!is.na(new_name))
      rest <- rest |> select(one_of(new_names$field_name))
    } else {
      new_names <- new_names |>
        mutate(new_name = coalesce(new_name, paste(dataset, field_name, sep="_")))
    }
    names(rest) <- new_names$new_name
    cbind(result, rest)
  }) |> bind_rows()
}

