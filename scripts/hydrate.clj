(ns hydrate
  (:require [babashka.http-client :as http]
            [clj-yaml.core :as yaml]
            [babashka.cli :as cli]
            [clojure.walk :as walk]
            [babashka.json :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(def cli-spec
  {:spec {:github-api-url {:default "https://api.github.com"}
          :work-path      {:default "content/work.md"}
          :output-path    {:default "data/work.json"}}})

(defn ->repos-pull-url
  [{:keys [github-api-url]} & parts]
  (let [[maybe-org-repo maybe-repo-id id] parts]
    (cond 
      (and maybe-org-repo maybe-repo-id id)
      (format "%s/repos/%s/%s/pulls/%d" github-api-url maybe-org-repo maybe-repo-id id)
      
      (and maybe-org-repo maybe-repo-id)
      (format "%s/repos/%s/pulls/%d" github-api-url maybe-org-repo maybe-repo-id)
      
      :else (throw (ex-info "Can't generate URL" {:parts parts})))))

(defn pull->meta
  [opts org-repo pull-id]
  (let [full-name (subs (str org-repo) 1)
        uri (->repos-pull-url opts full-name pull-id)]
    (some-> (http/get uri)
            :body
            (json/read-str)
            (select-keys [:merged :created_at :merged_at :additions :deletions :html_url])
            (assoc :full_name full-name))))

(defn ->contributions
  [opts form]
  (if-not (sequential? form)
    form
    (let [org-repo (first form)
          pull-id  (second form)]
      (if (and (keyword? org-repo) (number? pull-id))
        (let [meta (pull->meta opts org-repo pull-id)]
          [:meta meta])
        (into [] form)))))

(defn hydrate
  [& args]
  (let [{:keys [work-path output-path] :as opts} (cli/parse-opts args cli-spec)]
    (when-let [{:keys [contributions]} (->> (str/split (slurp work-path) #"---" -1)
                                            (filter (comp not str/blank?))
                                            (first)
                                            (yaml/parse-string))]

      (with-open [w (io/writer output-path)]
        (.write w (json/write-str
                    {:contributions
                     (walk/postwalk
                       (partial ->contributions opts) (into [] contributions))}))))))
