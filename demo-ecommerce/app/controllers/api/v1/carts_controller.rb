module Api
  module V1
    class CartsController < BaseController
      before_action :set_cart

      # GET /api/v1/cart
      def show
        render json: @cart
      end

      # POST /api/v1/cart/items
      def add_item
        product = Product.find(params[:product_id])
        quantity = (params[:quantity] || 1).to_i

        @cart.add_product(product, quantity)
        render json: @cart
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Product not found" }, status: :not_found
      end

      # PATCH /api/v1/cart/items/:product_id
      def update_item
        product_id = params[:product_id].to_i
        quantity = params[:quantity].to_i

        @cart.update_item_quantity(product_id, quantity)
        render json: @cart
      end

      # DELETE /api/v1/cart/items/:product_id
      def remove_item
        product_id = params[:product_id].to_i
        @cart.remove_product(product_id)
        render json: @cart
      end

      # DELETE /api/v1/cart
      def clear
        @cart.clear!
        render json: @cart
      end

      private

      def set_cart
        token = request.headers["X-Cart-Token"]

        if token.blank?
          render json: { error: "X-Cart-Token header is required" }, status: :bad_request
          return
        end

        @cart = Cart.find_or_create_by_token(token)
      end
    end
  end
end
