module Api
  module V1
    class BaseController < ApplicationController
      skip_before_action :verify_authenticity_token
    end
  end
end
