ARG RUBY_VERSION=3.3.7
ARG UID=1000
ARG GID=1000
ARG NON_ROOT_USER=rails
ARG BUNDLE_PATH=/home/${NON_ROOT_USER}/bundle
ARG NODE_PATH=/home/${NON_ROOT_USER}/node
ARG APP_PATH=/home/${NON_ROOT_USER}/app

FROM ruby:${RUBY_VERSION}-bullseye as base

# Re-declare ARGs after FROM (they don't persist across stages)
ARG UID
ARG GID
ARG NON_ROOT_USER
ARG BUNDLE_PATH
ARG NODE_PATH
ARG APP_PATH

ARG NODE_VERSION=24.13.0

# Install base packages
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    apt-transport-https \
    curl \
    libjemalloc2 \
    libvips \
    sqlite3 \
    libpq-dev \
    build-essential \
    vim \
    nano \
    libmariadb-dev \
    net-tools \
    psmisc && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Install Node.js
ENV PATH=$NODE_PATH/bin:$PATH
RUN curl -sL https://github.com/nodenv/node-build/archive/master.tar.gz | tar xz -C /tmp/ && \
    /tmp/node-build-master/bin/node-build "${NODE_VERSION}" ${NODE_PATH} && \
    corepack enable && \
    rm -rf /tmp/node-build-master

# Set production environment
ENV RAILS_ENV="production" \
    NODE_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH=${BUNDLE_PATH} \
    BUNDLE_WITHOUT="development test"

# Mac/Linux GID compatibility: Delete any existing group with the same GID
RUN getent group $GID | cut -d: -f1 | xargs -r groupdel || true

# Create non-root user and workspace with matching UID/GID from host
RUN groupadd --gid $GID ${NON_ROOT_USER} && \
    useradd --uid $UID \
    --gid ${NON_ROOT_USER} \
    --shell /bin/sh \
    --create-home ${NON_ROOT_USER}
RUN mkdir -p $APP_PATH && chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} /home/${NON_ROOT_USER}
WORKDIR $APP_PATH

USER ${NON_ROOT_USER}

# Throw-away build stage to reduce size of final image
FROM base AS build

# Re-declare ARGs after FROM (they don't persist across stages)
ARG UID
ARG GID
ARG NON_ROOT_USER
ARG BUNDLE_PATH
ARG NODE_PATH
ARG APP_PATH

# Install packages needed to build gems
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y git libyaml-dev pkg-config && \
    rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Mac/Linux GID compatibility: Delete any existing group with the same GID
RUN getent group $GID | cut -d: -f1 | xargs -r groupdel || true

# Create non-root user and workspace with matching UID/GID from host
RUN groupadd --gid $GID ${NON_ROOT_USER} && \
    useradd --uid $UID \
    --gid ${NON_ROOT_USER} \
    --shell /bin/sh \
    --create-home ${NON_ROOT_USER}
RUN mkdir -p $APP_PATH && chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} /home/${NON_ROOT_USER}
WORKDIR $APP_PATH

USER ${NON_ROOT_USER}

# Install application gems
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} Gemfile Gemfile.lock ./
RUN bundle install && \
    rm -rf /home/${NON_ROOT_USER}/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    bundle exec bootsnap precompile --gemfile

# Install Node packages
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# Copy application code
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} . .

# Precompile bootsnap code for faster boot times
RUN bundle exec bootsnap precompile app/ lib/

# Precompiling assets for production without requiring secret RAILS_MASTER_KEY
RUN SECRET_KEY_BASE_DUMMY=1 ./bin/rails assets:precompile




# Final stage for app image
FROM base

# Re-declare ARGs after FROM (they don't persist across stages)
ARG UID
ARG GID
ARG NON_ROOT_USER
ARG BUNDLE_PATH
ARG APP_PATH

# Copy built artifacts: gems, application
COPY --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --from=build ${APP_PATH} ${APP_PATH}

WORKDIR ${APP_PATH}

# For twin-servers A/B testing: CMD and ENTRYPOINT are removed
# docker-compose will use 'command: sleep infinity' instead
# This allows starting/stopping/restarting servers without restarting containers

# Entrypoint prepares the database.
# ENTRYPOINT ["/rails/bin/docker-entrypoint"]

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
# CMD ["./bin/rails", "server"]
