# shaka-twin-servers
Provide a docker image and get two servers running side-by-side both locally and on CircleCI

## List of features (TODO: replace by proper readme)
* can copy local changes to docker containers
* can restart servers without restarting containers
* docker volumes are mounted and editable without sudo
* logs for control and experiment are side-by-side, prefixed by [CONTROL]/[EXPERIMENT]
* README makes intuitive sense and not specific to any project
* bash helper commands for running arbitrary bash inside the containers
* CircleCI integration
    * Can forward ports in order to access servers locally
    * bash helper functions work when connecting through SSH
    * can copy local changes to CI (including to docker volumes on CI)
    * docker volumes are mounted and editable without sudo
    * logs for control and experiment are in separate CircleCI entrances
